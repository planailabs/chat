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

## Deployment

`package.nix` packages the server and the UI (`web/`) separately; `module.nix` is the NixOS module and points the server at the UI (`web.static_dir`).
