# The chat's agents on a subagent-net hub. Apply with `subnet apply chat.hcl`
# (or merge into the hub's cluster). Environment it needs:
#   hub:   CHAT_CALLBACK_SECRET (the chat server's [subnet].callback_secret)
#   nodes: CHAT_CALLBACK_SECRET, LITELLM_API_KEY, CONTEXT7_API_KEY, FIRECRAWL_API_KEY
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
  idempotent = ["product_get", "catalog_get", "skill_get", "artifact_list", "artifact_get"]
}

# Acting as the user on plan.ai services (Zitadel token exchange).
mcp "connector" {
  url        = "http://127.0.0.1:8080/connector/mcp"
  credential = { header = "Authorization", env = "CHAT_CALLBACK_SECRET", prefix = "Bearer " }
  nodes      = ["chat"]
  lazy       = false
  idempotent = ["list_services", "list_tools"]
}

# Up-to-date library and API docs.
mcp "context7" {
  url        = "https://mcp.context7.com/mcp"
  credential = { header = "Authorization", env = "CONTEXT7_API_KEY", prefix = "Bearer " }
  nodes      = ["chat"]
  idempotent = ["resolve-library-id", "query-docs"]
}

# Web search, scraping and research papers. Crawls, agents, browser sessions
# and monitors cost credits or keep running: they go through the approval hook.
mcp "firecrawl" {
  url        = "https://mcp.firecrawl.dev/v2/mcp"
  credential = { header = "Authorization", env = "FIRECRAWL_API_KEY", prefix = "Bearer " }
  nodes      = ["chat"]
  idempotent = ["firecrawl_search", "firecrawl_scrape", "firecrawl_map", "firecrawl_check_crawl_status", "firecrawl_agent_status"]
}

# Layered approval (static checks → validator model → the user) of every
# call made as the user. The user's decision comes after this answers `ask`.
hook "approval" {
  on         = "pre_tool"
  # The hub's built-ins that reach other agents are here too: the hub doesn't
  # keep users apart, the chat limits them to the user's own agents.
  tools      = ["connector.call_tool", "firecrawl.firecrawl_crawl", "firecrawl.firecrawl_agent", "firecrawl.firecrawl_interact*", "firecrawl.firecrawl_monitor_*",
                "firecrawl.firecrawl_scrape", "firecrawl.firecrawl_map", "firecrawl.firecrawl_extract",
                "send_message", "list_agents", "list_types", "mailbox_*", "blob_get", "pause_agent", "resume_agent", "cancel_agent"]
  run        { url = "http://127.0.0.1:8080/hooks/pre_tool" }
  credential = { header = "Authorization", env = "CHAT_CALLBACK_SECRET", prefix = "Bearer " }
  timeout    = "60s"   # the validator model's call
  on_lost    = "deny"
}

# list_agents shows every user's agents: narrowed to the caller's user's.
hook "own-agents" {
  on         = "post_tool"
  tools      = ["list_agents"]
  run        { url = "http://127.0.0.1:8080/hooks/post_tool" }
  credential = { header = "Authorization", env = "CHAT_CALLBACK_SECRET", prefix = "Bearer " }
  timeout    = "10s"
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
  budget       = { max_tokens = 40000000, max_depth = 1, max_children = 6 }
  spawns       = ["worker"]
  hooks        = ["approval", "own-agents"]
  call_reasons = true
  isolated     = true   # the hub keeps its agents within their user (tenant)
  # Long conversations: summarised at 64k tokens (deepseek-flash has room
  # for more, but cost and focus drop well before), the last 8 messages kept
  # as they are; search_history finds what a summary left out.
  compact = {
    at_tokens    = 64000
    keep         = 8
    instructions = "Keep the user's goals and decisions, what was changed on which service (by name), approvals still open, the pages (artifacts) published and what they're for, workers still running and what they were asked, and anything the user asked to remember."
  }
  search_history = true
  # Results over 8000 characters reach the model cut; it greps or reads the rest
  # (grep_result). Docs and skills are meant to be read whole.
  grep_results = { over = 8000, except = ["chat.product_get", "chat.skill_get"] }

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
    - For current facts from the web (news, prices, a company's site, papers) use firecrawl search/scrape; for how a library, framework or API works use context7 (resolve the library id, then query its docs). Say where an answer comes from.
    - Before helping the user set something up, load the matching skill with `chat.skill_get` and follow it: `cms-agent-setup` (a cms-agent instance: repository, deploy type, subdomain, sign-in, model, accounts, its URL) and `cloud-setup` (a plan.ai cloud organization, its identity accounts and identity providers).
    - When something is easier to look at or use than to read (numbers over time, comparisons, status overviews, a form with several fields, a small tool), show it as an interactive page beside the chat: load the `artifacts` skill with `chat.skill_get`, then `chat.artifact_publish`. Not for plain answers. A service's own view (a call_tool result naming a `ui-view:`) is already shown to the user; don't rebuild it.
    - For a self-contained job of many steps (going through many services, items or pages; researching several sources), hand it to sub-agents: `spawn_agent` with type `worker` and a complete prompt (they don't see this conversation: say what to find, where, and what to report), several at once for independent parts, then `wait_for` them and use their reports. Workers' calls go through the same checks as yours.
    - Never work around the safety checks (spreading calls out, rephrasing a denied call): a denied call means stop and tell the user or ask them.
    - Ask questions with `ask_question`, never in plain text; one question at a time unless it's multiple choice.
    - Use `chat.staff_ping_send` when the user wants a demo, a callback, custom pricing, or help you can't give (a hardware issue, manual support); then tell them the team will follow up.
    - Only if the context says "Newsletter: not asked yet", you may offer the newsletter once with `prompt_preference` (preference_id "newsletter"), and only when the conversation winds down after the user's goal is done. Never offer it during a task, or right after a question, a decision, a cancellation or a problem.
  EOT
}

# A worker the assistant hands a self-contained task to (spawn_agent type
# "worker"): same tools and checks, no user of its own; it reports back.
agent "chat-worker" {
  description = "A worker of the plan.ai assistant: does one self-contained task (a scan, research, a batch of reads) and reports back."
  credential {
    env      = "LITELLM_API_KEY"
    base_url = "https://codex.plan.ai/v1"
  }
  model        = "deepseek-flash"
  nodes        = ["chat"]
  params       = { max_tokens = 4096 }
  budget       = { max_tokens = 4000000, max_depth = 0, max_children = 0 }
  hooks        = ["approval", "own-agents"]
  call_reasons = true
  isolated     = true   # the hub keeps its agents within their user (tenant)
  # A worker's task is narrower: summarised sooner, keeping what it found.
  compact = {
    at_tokens    = 48000
    keep         = 6
    instructions = "Keep every fact found so far with its source (URL, service and tool), what was changed, and what of the task is still left to do."
  }
  grep_results = 6000

  system_prompt = <<-EOT
    You are a worker of the plan.ai assistant. It gives you one self-contained task; you do it and finish with a report to it. You can't talk to the user.

    - Work as the user on their plan.ai services: `connector.list_services`, `connector.list_tools` {service} (read a tool's schema before calling it), `connector.call_tool` {service, tool, arguments}. Give every tool call a short `_reason`.
    - Do what the task asks and nothing more: read freely; change things only if the task says so. Calls that change things may wait for the user's approval in the chat; if one is denied, don't retry or work around it: report it.
    - Never work around the safety checks (spreading calls out, rephrasing a denied call).
    - Your last message is the report: the facts and numbers found (with names, never ids), what you changed, and what you couldn't do and why. Be concise; no greetings.
  EOT
}

mixture "worker" {
  agent = "chat-worker"
  mcp   = ["chat", "connector", "context7", "firecrawl"]
}

# What the chat spawns ([subnet].agent_type).
mixture "chat" {
  agent = "chat-agent"
  mcp   = ["chat", "connector", "context7", "firecrawl"]
}
