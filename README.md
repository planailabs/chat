# plan.ai-chat (chat.plan.ai)

The plan.ai chat: signed-in users have conversations with the plan.ai assistant (questions about plan.ai, and configuring their plan.ai services where those are reachable), as many as they like, and admins get a dashboard (stats, chat traffic, impersonation, staff pings, a prompt extension per user).

## Architecture

- **Server** (`server/`, Rust/axum): the API at `/api/v1/...` (REST, plus OpenAPI at `/api/v1/docs` and MCP at `/mcp`), the chat event stream (`/api/v1/chat/events`), Zitadel sign-in (`/auth/login`, `/auth/logout`, cookie session) and the static UI. Postgres holds profiles, the chat mirror, token usage, staff pings and prompt extensions (`server/migrations/`).
- **Agents**: each conversation is an agent on subagent-net (`git.plan.ai/plan-ai/subagent-net`) (the hub, `subnet`, configured by `subnet/chat.hcl`). The server spawns and messages agents, follows the hub's events and streams them to the browser; tool calls can wait for the user's approval.
- **UI** (`web/`, TypeScript + Vite + Tailwind 4, no framework): the chat (`web/index.html`, `web/src/chat/`; a sidebar with the conversations and plan.ai's applications, `/c/<id>` for a conversation) and the admin dashboard (`web/dashboard/index.html`, `web/src/dashboard/`), both using the typed API client in `web/src/chat/api.ts`. Built to `web/dist`, which the server serves.
- **Shared crates** (`common/`, git submodule): API/MCP registry, auth, accounts, connector.

## Running locally

```bash
nix develop                        # Rust, Node 22, pnpm, Postgres, overmind, subnet
cp config.example.toml config.toml # edit as needed (the Procfile does this if missing)
overmind start
```

`overmind` runs the `Procfile`: Postgres on 127.0.0.1:5433 (data in `.pg/`), the subagent-net hub, the UI build in watch mode and the server on <http://127.0.0.1:8080>.

Without an `[auth]` section a debug build signs everyone in as dev@localhost (admin) when started with `DEV_ONLY_NO_AUTH=1`; otherwise configure Zitadel in `config.toml` (see the comments in `config.example.toml`). Secrets can live in a separate file named by `CONFIG_SECRETS_PATH`.

For UI work with hot reload, `cd web && pnpm dev` serves the UI on Vite's port and proxies `/api` and `/auth` to the server.

## Testing

```bash
cd web && pnpm test                        # Vitest (UI)
cd web && pnpm exec tsc --noEmit -p .      # type check
cargo test                                 # server and shared crates
```

## Deployment

`package.nix` packages the server and the UI (`web/`) separately; `module.nix` is the NixOS module and points the server at the UI (`web.static_dir`).
