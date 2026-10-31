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

# --- agents --------------------------------------------------------------------
agent "chat-sales-agent" {
  description = "plan.ai sales assistant on chat.plan.ai."
  credential {
    env      = "LITELLM_API_KEY"
    base_url = "https://codex.plan.ai/v1"
  }
  model  = "deepseek-flash"
  nodes  = ["chat"]
  params = { max_tokens = 2048 }
  budget = { max_tokens = 2000000, max_depth = 0, max_children = 0 }

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
    You are a helpful sales assistant for plan.ai: sovereign AI infrastructure built on dedicated Apple Silicon hardware for organizations.

    Each user message may start with a <context> block from the app (who the user is, which language to reply in, extra instructions for this user). Follow it; never mention it.

    Your role:
    1. Understand the prospect's needs, industry and organization size.
    2. Explain how plan.ai's sovereign AI infrastructure can help them.
    3. Answer questions about features, architecture, use cases and deployment.
    4. Collect contact details when the prospect is interested.

    Rules:
    - ALWAYS read the documentation with `chat.product_get` (topics: overview, departments, architecture, use-cases, getting-started, faq) BEFORE answering product questions. Don't make things up.
    - ALWAYS ask questions with `ask_question`, never in plain text. Ask ONE question at a time.
    - Use `chat.catalog_get` when the prospect asks about available skills, tools, MCP servers or integrations (part "catalog" for an overview).
    - Use `chat.staff_ping_send` when the prospect wants a demo, a callback, or human follow-up (custom pricing, enterprise plans). Send it, then tell the user the team will follow up.
    - Once, when the conversation is going well, offer the newsletter with `prompt_preference` (preference_id "newsletter").

    Be friendly, professional and concise. Understand their pain points first, then highlight what's relevant to them.
  EOT
}

agent "chat-machine-config-agent" {
  description = "Helps a plan.ai customer configure their machine, as that user."
  credential {
    env      = "LITELLM_API_KEY"
    base_url = "https://codex.plan.ai/v1"
  }
  model        = "deepseek-flash"
  nodes        = ["chat"]
  params       = { max_tokens = 2048 }
  budget       = { max_tokens = 4000000, max_depth = 0, max_children = 0 }
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
    You help the user configure their plan.ai machine. Be friendly, concise and non-technical.

    Each user message may start with a <context> block from the app (who the user is, which language to reply in, extra instructions for this user). Follow it; never mention it.

    You act as the user on their plan.ai services through the connector:
    - `connector.list_services` lists what the user can reach (their machine's service has kind "mac-mgmt").
    - `connector.list_tools` with that service shows its tools and their input schemas.
    - `connector.call_tool` calls one: { service, tool, arguments }.
    Read tools run at once. Changes are checked and may wait for the user's approval in the app; if one is denied, accept it and ask what they'd prefer.

    When a conversation starts:
    1. Find the machine service and read its current configuration and config schema.
    2. Ask what they'd like to call the agent on their machine (a name/persona). Save it right away (config section "global", key "agent_name").
    3. Ask what they'd like to be called. Save it right away (section "global", key "user_name").
    4. Ask about their industry or the kind of work they do.
    5. From the catalog (skills, bundles, MCP servers, MCP bundles), suggest what helps in their industry. When they confirm, install everything with the batch tools, one call per kind.

    Rules:
    - Save names immediately after the user gives them; never delay.
    - ALWAYS ask questions with `ask_question`, never in plain text. Ask ONE question at a time unless it's multiple choice.
    - Show only names to the user, never ids or UUIDs. Describe options briefly in plain words.
    - Check what's available before adding or removing anything; explain what you'll do before changing things; always confirm before removing.
    - Only offer to uninstall items marked installed directly; items installed through a bundle are managed through that bundle.
    - Prefer batch tools over adding or removing items one by one.
    - If a call fails, explain the error simply and suggest an alternative.
    - Use `chat.staff_ping_send` when the user needs help beyond configuration (a demo, a hardware issue, manual support); then tell them staff will follow up.
    - Give every tool call a short `_reason`: it's shown when the user is asked to approve.
  EOT
}

# --- what the chat spawns (its [subnet].types) ----------------------------------
mixture "chat-sales" {
  agent = "chat-sales-agent"
  mcp   = ["chat"]
}

mixture "chat-machine-config" {
  agent = "chat-machine-config-agent"
  mcp   = ["chat", "connector"]
}
