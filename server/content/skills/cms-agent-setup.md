# Skill: set up a cms-agent instance

cms-agent is plan.ai's agentic CMS: it edits a website's repository (Astro or plain HTML), shows previews and publishes. This walks the user from "I want a cms-agent" to a URL they can open. Every console call goes through `connector.call_tool` with the console as `service` (find it with `connector.list_services`; it's the plan.ai cloud console, usually named `cloud`). Read a tool's input schema with `connector.list_tools` before the first call. Ask with `ask_question`, one thing at a time; offer choices where there are known answers.

## 0. Where it lives
- `organizations_list`: the user's organization. None → run the **cloud-setup** skill first (organization creation).
- `instances_list`: an existing `cms-agent` instance? Ask whether to set that one up or make a new one.
- A new one: `subscriptions_catalog` for the price, `regions_available` for where it can run (ask if more than one), then `instances_create` with product `cms-agent` (seats: ask, default 5). It costs money — the approval card shows the price and the user confirms it; never describe it as free.
- Wait until `instances_get` shows it `ready`/`running` (provisioning takes a few minutes; check every so often, tell the user what's happening).

## 1. The repository
Ask: clone an existing repository, or start an empty one?
- **Clone**: ask for the repository URL (`git@host:owner/repo.git` or https). `repo_key` gives the instance's public SSH key — the user must add it as a deploy key **with write access** on that repository (GitHub: Settings → Deploy keys). Wait until they say it's done, then `repo_url` with the URL, then `repo_clone`. A clone that fails with "Permission denied (publickey)" means the key isn't added yet.
- **Empty**: `repo_init`. Then ask for a remote (optional — "skip" is fine, it can be set later); with one: show `repo_key`'s public key to add as a write deploy key, then `repo_remote`.
- Check with `repo_list`: `cloned` true and a `head` commit.

## 2. Where a publish goes
`repo_deploy` shows the current deploy type. Ask which one they want:
- `git-push` — publishing pushes to the remote (their own CI/hosting deploys from there),
- `github-ci` — pushes and follows the GitHub Actions run (needs `owner/repo` and a GitHub token),
- `cloudflare-pages` — deploys to Cloudflare Pages (account id, project, API token),
- `web-agency` — plan.ai's web agency hosting,
- `none` — publishing only commits; nothing is deployed (the default for an empty repository without a remote).
Then `repo_set_deploy`. Tokens are stored encrypted and never shown again; never repeat a token back to the user.

## 3. Connections
`connections_list` for the instance shows its endpoints: `ingress` (required), `identity`, `inference` (required). `connections_providers` lists what the organization can connect them to; `connections_offers` what it could register.
- **Ingress** (where it's reachable): ask for the subdomain (suggest `cms`). cms-agent needs the whole space below that name too (branch previews at `<branch>.<name>`). `connections_connect` with endpoint `ingress`, the organization's console-managed ingress provider (kind `managed`, from `connections_providers`) and `fields: {"subdomain": "<their answer>"}` — it answers under the organization's own zone (e.g. `<subdomain>.<org-slug>.cloud.plan.ai`). One service per subdomain: a taken one is refused, ask for another. Check with `hosts_list`.
- **Identity** (who can sign in): connect `identity` to the organization's own identity (plan.ai's Zitadel organization for this customer). Nothing to ask.
- **Inference** (the model it thinks with): `connections_provider-choices` lists the models plan.ai's gateway serves — ask which one (recommend the default the provider suggests), then `connections_connect` with endpoint `inference`, the plan.ai gateway provider and `fields: {"model": "<their choice>"}`.
Connecting mints what's needed and restarts the service with it; if a connect fails, say what failed and offer `instances_retry`/`organizations_retry_setup` before trying again.

## 4. Accounts (optional)
Ask whether others should sign in to it. `organizations_identity_accounts` shows who can already; for each new person ask for their email and name, then `organizations_identity_account`. The one-time password it returns is shown once: give it to the user to pass on, and say it must be changed on first sign-in. The user themself may need an account too (check `organizations_identity`).

## 5. Done
Give the user the URL from the ingress (`https://<host>/`), say they sign in with their organization account, and that the agent edits on a branch, shows a preview, and publishes the way they chose in step 2. Mention they can come back here to change the repository, deploy type or accounts.
