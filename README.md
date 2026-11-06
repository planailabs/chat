# plan.ai-chat (chat.plan.ai)

The plan.ai chat: signed-in users have conversations with the plan.ai assistant (questions about plan.ai, and configuring their plan.ai services where those are reachable), as many as they like, and admins get a dashboard (stats, chat traffic, impersonation, staff pings, a prompt extension per user).

## Architecture

- **Server** (`server/`, Rust/axum): the API at `/api/v1/...` (REST, plus OpenAPI at `/api/v1/docs` and MCP at `/mcp`), the chat event stream (`/api/v1/chat/events`), Zitadel sign-in (`/auth/login`, `/auth/logout`, cookie session) and the static UI. Postgres holds profiles, the chat mirror, token usage, staff pings and prompt extensions (`server/migrations/`).
- **Agents**: each conversation is an agent on subagent-net (`git.plan.ai/plan-ai/subagent-net`) (the hub, `subnet`, configured by `subnet/chat.hcl`). The server spawns and messages agents, follows the hub's events and streams them to the browser; tool calls can wait for the user's approval.
- **UI** (`web/`, Vue 3 + Vue Router + TypeScript, built by Parcel, Tailwind 4): the chat (`web/index.html`, `web/src/chat/`; a sidebar with the conversations and plan.ai's applications, `/c/<id>` for a conversation) and the admin dashboard (`web/dashboard/index.html`, `web/src/dashboard/`), both using the typed API client in `web/src/chat/api.ts`. Built to `web/dist`, which the server serves.
- **Shared crates** (`common/`, git submodule): API/MCP registry, auth, accounts, connector.

## Running locally

```bash
nix develop                        # Rust, Node 22, pnpm, Postgres, overmind, subnet
cp config.example.toml config.toml # edit as needed (the Procfile does this if missing)
overmind start
```

`overmind` runs the `Procfile`: Postgres on 127.0.0.1:5433 (data in `.pg/`), the subagent-net hub, the UI build in watch mode and the server on <http://127.0.0.1:8080>.

Without an `[auth]` section a debug build signs everyone in as dev@localhost (admin) when started with `DEV_ONLY_NO_AUTH=1`; otherwise configure Zitadel in `config.toml` (see the comments in `config.example.toml`). Secrets can live in a separate file named by `CONFIG_SECRETS_PATH`.

For UI work with hot reload, `cd web && pnpm dev` serves the UI on <http://localhost:1234> (Parcel) and proxies `/api` and `/auth` to the server (`web/.proxyrc.cjs`).

## Testing

```bash
cd web && pnpm test                        # Vitest + Vue Test Utils (UI)
cd web && pnpm typecheck                   # vue-tsc
cargo test                                 # server and shared crates
```

## Connectors (the assistant's MCP servers)

The assistant reaches services through the connector (`/connector/mcp`,
`common/plan-ai-connector`): `list_services`, `list_tools`, `call_tool`.
Its services for a user are

- **configured apps**, `[[apps]]` with `mcp` (see `config.example.toml`),
  gated by `emails`. `mcp.auth` is `zitadel` (default: token exchange as the
  user, `audience_project_id`), `bearer` (a static token from the secrets
  file, `[secrets.app_tokens] <name> = "…"`), `oauth` (MCP OAuth; every user
  connects their own account in Settings → Connectors) or `none`. `url`,
  `icon` and `label` make the same entry a sidebar link, independently. E.g.

  ```toml
  [[apps]]
  name = "prometheus"
  description = "Prometheus metrics of plan.ai's infrastructure"
  kind = "prometheus"
  url = "https://prometheus.plan.ai"        # sidebar link
  icon = "chart"
  label = { en = "Metrics", de = "Metriken" }
  mcp = { url = "https://prometheus-mcp.plan.ai/mcp", auth = "bearer" }
  emails = ["*@plan.ai"]

  # in the secrets file (CONFIG_SECRETS_PATH):
  [secrets.app_tokens]
  prometheus = "…"
  ```

- the user's **plan-ai-cloud deployments** (`[connector.console]`);
- **connectors** users add themselves (Settings → Connectors, API
  `connector_*`), stored in Postgres (`server/migrations/0009_connectors.sql`).
  A connector belongs to a team (plan-ai-accounts); every member uses it,
  only team admins add, change or remove it; personal connectors are the
  personal team's. Auth: a bearer token (one per connector), OAuth (generic
  MCP OAuth: RFC 9728/8414 discovery, dynamic client registration required,
  PKCE, RFC 8707 resource, refresh; `shared` = one connection made by an
  admin for the team, `per_member` = everyone connects their own), or none.
  User servers must be https on public addresses (checked on save and on
  every connection, DNS answers pinned; redirects too), and what they send is
  size-limited. Calls are approved like any service call (by the tool's own
  annotations: read-only runs, mutating/destructive asks).

  **Names**: a personal connector is listed by its name (`docs`), a team's as
  `<team>/<name>` (`acme/crm`; `<team>` is the team name lowercased, other
  characters as `-`, at most 24); teams whose names come out the same get
  `-<6 hex of the team id>`; a configured app or deployment of the same name
  wins over a personal connector, which becomes `me/<name>`.

Connector secrets (bearer tokens, OAuth tokens, client secrets) are
encrypted with `[secrets].connector_encryption_key` (32 bytes, base64:
`openssl rand -base64 32`) and never returned by the API. Without the key,
users can't add connectors and OAuth apps don't start; the server refuses to
start when connectors are stored but the key is missing. OAuth sign-ins
come back to `/connectors/oauth/callback` (`[auth].external_url`); the
state is bound to the signed-in user and the browser that started it.

## MCP for outside clients

`/public/mcp` offers the chat's own API and the user's plan.ai services
(the connector's `list_services`, `list_tools`, `call_tool`, as the chat's
agents see them) to MCP clients such as Claude,
ChatGPT or Cursor. They sign in with OAuth 2.1 against the chat itself
(`common/plan-ai-oauth`: dynamic client registration, PKCE, consent on the
usual Zitadel sign-in); accounts waiting for approval can't connect. Every call
goes through the same approval as the agents' (`hook`): risky calls ask the
user in the client (elicitation), and purchases are off unless the user turns
on "Purchases from MCP clients" in the settings, then confirmed with the price.
It needs `[auth]` (real sign-in); with `DEV_ONLY_NO_AUTH` it isn't mounted.

## Workers (sub-agents)

The assistant may hand self-contained jobs to workers (`spawn_agent` type
`worker` in `subnet/chat.hcl`: up to 6 at once, one level deep, budget carved
from its own). The chat learns of one from its parent's `child_spawned`
(`conversation_children`): a worker's calls count as its conversation's (the
approval hook, pages, services' views), its tool runs and approvals show
there, approving goes to the worker that asked, and the history lists what
open workers wait on. Workers have no user of their own; they report to the
assistant.

The approval hook's loop guard (`hook::static_check`) refuses an identical
call made in the last 20 unless something was changed since, and a writing
tool used more than 6 times in 20; reads over many items pass.

The hub doesn't keep users apart by itself: the chat's agent types are
`isolated` (their agents message and list only their own user's agents, no
mailboxes), and the hook checks the same again (`send_message` only to the
user's agents, `list_agents` narrowed by a `post_tool` hook).

## Pages (artifacts and MCP Apps views)

The assistant can show the user an interactive page beside the conversation
(`chat.artifact_publish`; the `artifacts` skill tells it how): HTML on the
generative-ui suite (`generative-ui/`, a submodule: `<ui-*>` components and
the chat's design as MCP Apps style variables), versioned by name, with a KV
view the page binds and optional backflow handlers (JavaScript run by
gui-runtime with only their KV: no network, no files). A service tool with an
MCP Apps view (`_meta.ui.resourceUri`) gets its view kept with the call
(`artifacts::ChatViews`, via the connector).

The browser shows a page in sandboxed frames without origin: a trusted outer
`srcdoc` document carries the CSP (none of the network for artifacts, a
view's declared origins for views) and relays messages; the page is its
nested `srcdoc` frame, which inherits that policy whatever its markup does.
The chat answers with `frame-src 'none'`, so no frame can navigate away from
its policy. The browser is the page's MCP Apps host (`web/…/pageHost.ts`): a
tool call goes to `/api/v1/pages/{id}/call`, where reads of tools the service
marks read-only go through and anything else asks the user with the whole
call (allowed with a one-time token; purchases never happen from a page). A
page speaks for the user (an action without a handler, `ui/message`) only
right after they acted on it, labelled as the page's; opening a link and
full screen need the user too; `ui/update-model-context` rides on the next
message. Handlers run a few at a time, one per user, with capped KV, events
and logs.

## Deployment

`package.nix` packages the server and the UI (`web/`) separately; `module.nix` is the NixOS module and points the server at the UI (`web.static_dir`).
