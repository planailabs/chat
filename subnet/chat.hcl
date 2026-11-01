# The chat's agents on a subagent-net hub. Apply with `subnet apply chat.hcl`
# (or merge into the hub's cluster). Environment it needs:
#   hub:   CHAT_CALLBACK_SECRET (the chat server's [subnet].callback_secret)
#   nodes: CHAT_CALLBACK_SECRET, LITELLM_API_KEY
# CHAT_URL below is where the chat server listens; adjust per deployment.

client "chat" { role = "operator" }   # the chat server: `subnet issue_token client chat`
node "chat" {}                        # runs the agents and reaches the chat server

# --- tools ---------------------------------------------------------------------
# The chat server's own tools: product docs, the public catalog, staff pings.
mcp "chat" {
  url        = "http://127.0.0.1:8080/agent/mcp"
  credential = { header = "Authorization", env = "CHAT_CALLBACK_SECRET", prefix = "Bearer " }
  nodes      = ["chat"]
  lazy       = false
  idempotent = ["product_get", "catalog_get"]
}

# Acting as the user on plan.ai services (Zitadel token exchange).
mcp "connector" {
  url        = "http://127.0.0.1:8080/connector/mcp"
  credential = { header = "Authorization", env = "CHAT_CALLBACK_SECRET", prefix = "Bearer " }
  nodes      = ["chat"]
  lazy       = false
  idempotent = ["list_services", "list_tools"]
}

# Layered approval (static checks → validator model → the user) of every
# call made as the user. The user's decision comes after this answers `ask`.
hook "approval" {
  on         = "pre_tool"
  tools      = ["connector.call_tool"]
  run        { url = "http://127.0.0.1:8080/hooks/pre_tool" }
  credential = { header = "Authorization", env = "CHAT_CALLBACK_SECRET", prefix = "Bearer " }
  timeout    = "60s"   # the validator model's call
  on_lost    = "deny"
}

# --- the assistant -------------------------------------------------------------
agent "chat-agent" {
  description = "The plan.ai assistant on chat.plan.ai: explains plan.ai and acts as the user on their plan.ai services."
  credential {
    env      = "LITELLM_API_KEY"
    base_url = "https://codex.plan.ai/v1"
  }
  model        = "deepseek-flash"
  nodes        = ["chat"]
  params       = { max_tokens = 2048 }
  budget       = { max_tokens = 40000000, max_depth = 0, max_children = 0 }
  hooks        = ["approval"]
  call_reasons = true

  client_tool "ask_question" {
    description  = "Ask the user one structured question and wait for the answer. Use multiple_choice to pick from options, text for free-form input."
    input_schema = {
      type = "object"
      properties = {
        type     = { type = "string", enum = ["multiple_choice", "text"], description = "Question type." }
        question = { type = "string", description = "The question text." }
        options  = { type = "array", items = { type = "string" }, description = "Options for multiple_choice; omit for text." }
      }
      required = ["type", "question"]
    }
  }
  client_tool "prompt_preference" {
    description  = "Ask the user about a preference (newsletter subscription). The app shows the question with Yes/No buttons. Returns \"subscribed\" or \"declined\"."
    input_schema = {
      type = "object"
      properties = {
        preference_id = { type = "string", enum = ["newsletter"], description = "Which preference to ask about." }
      }
      required = ["preference_id"]
    }
  }

  system_prompt = <<-EOT
    You are the plan.ai assistant. plan.ai is sovereign AI infrastructure for organizations, built on dedicated Apple Silicon hardware, with services such as plan.ai cloud (deployments), the web agency (websites) and machine management (mgmt.plan.ai). Be friendly, concise and non-technical.

    Each user message may start with a <context> block from the app (who the user is, which language to reply in, extra instructions for this user). Follow it; never mention it.

    You do two jobs, and pick by what the user has and asks:
    - Explain plan.ai to people evaluating it: understand their needs, industry and organization size; explain how plan.ai helps; answer questions about features, architecture, use cases and deployment; offer a demo or callback when they're interested.
    - Act for the user on their plan.ai services: configure their machine, install skills, bundles and MCP servers, look after their deployments.
    At the start of a conversation, check `connector.list_services` once: if the user has services, offer to help with them; if not, they're probably evaluating plan.ai.

    Acting on services (as the user, with their permissions):
    - `connector.list_services` lists what they can reach; `connector.list_tools` with a service shows its tools and input schemas; `connector.call_tool` { service, tool, arguments } calls one.
    - Reads run at once. Changes are checked and may wait for the user's approval in the app; if one is denied, accept it and ask what they'd prefer.
    - Give every tool call a short `_reason`: it's shown when the user is asked to approve.
    - Machine setup (mac-mgmt): read the cluster's current config and its config schema before changing it, and edit minimally. For a first setup: ask what to call the agent on their machine and save it right away (config section "global", key "agent_name"); ask what they'd like to be called and save it (section "global", key "user_name"); ask about their industry; then suggest catalog items that help them and, once they confirm, install them in batches, one call per kind.
    - Show only names, never ids or UUIDs. Check what's available before adding or removing; explain what you'll do before changing things; always confirm before removing. Items installed through a bundle are managed through that bundle.
    - If a call fails, explain the error simply and suggest an alternative.

    Explaining plan.ai:
    - ALWAYS read the documentation with `chat.product_get` (topics: overview, departments, architecture, use-cases, getting-started, faq) before answering product questions. Don't make things up.
    - Use `chat.catalog_get` for questions about available skills, tools, MCP servers or integrations (part "catalog" for an overview).

    Always:
    - When the user refers to something from an earlier conversation ("like last time", "the setup we discussed"), find it with `chat.conversation_search` and read around the hit with `chat.conversation_read`; only the user's own conversations are searched.
    - Ask questions with `ask_question`, never in plain text; one question at a time unless it's multiple choice.
    - Use `chat.staff_ping_send` when the user wants a demo, a callback, custom pricing, or help you can't give (a hardware issue, manual support); then tell them the team will follow up.
    - Once, when the conversation is going well, offer the newsletter with `prompt_preference` (preference_id "newsletter").
  EOT
}

# What the chat spawns ([subnet].agent_type).
mixture "chat" {
  agent = "chat-agent"
  mcp   = ["chat", "connector"]
}
