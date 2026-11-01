# Skill: set up plan.ai cloud

plan.ai cloud (the console at cloud.plan.ai) runs a customer's services. Each organization gets its own identity: a Zitadel organization whose accounts sign in to the organization's services. This walks the user through the organization, its identity accounts and its identity providers. Every console call goes through `connector.call_tool` with the console as `service` (find it with `connector.list_services`; usually named `cloud`). Read a tool's input schema with `connector.list_tools` before the first call. Ask with `ask_question`, one thing at a time.

## 1. The organization
- `organizations_list`. If the user already has one, use it (several: ask which).
- None: ask for the organization's name (the company or team), then `organizations_claim` — they become its admin. (`organizations_create` is for plan.ai admins only.)
- `organizations_get` shows its members and whether setup finished. A step that failed: `organizations_retry_setup` (safe to run any time).
- Members of the organization (who may use the console for it): `organizations_add_member` with an email and role, when the user asks for colleagues.

## 2. Accounts in the organization's identity
These are the accounts people use to sign in to the organization's services (cms-agent, memvault, …) — separate from their plan.ai account.
- `organizations_identity`: what the user has there and where to sign in (the identity console URL).
- The user's own account: `organizations_identity_account` for their email; offer `owner: true` if they want to administer the identity themselves (users, policies, providers in Zitadel's own console).
- Others: ask for email and name per person, `organizations_identity_account`. `organizations_identity_accounts` lists everyone.
- A one-time password is returned once: hand it over, and say it must be changed at first sign-in. Never invent or reuse passwords.
- Deactivate (`organizations_identity_account_active`) rather than delete when someone only needs to be paused; deleting (`organizations_identity_account_delete`) removes their access to every group.

## 3. Identity providers (sign in with Google, Microsoft, GitHub, …)
Done with `organizations_identity_request` (Zitadel's management API in the organization's identity; org admins only).
- Ask which provider and whether accounts should be created automatically on first sign-in.
- The user registers an OAuth app at the provider first; give them the redirect URL Zitadel expects — `https://<identity domain>/ui/login/login/externalidp/callback`, the identity domain from `organizations_identity`. Ask for the client id and secret once they have them (never repeat the secret back).
- Create it, e.g. Google: `{method: "POST", path: "/management/v1/idps/google", body: {"name": "Google", "clientId": "…", "clientSecret": "…", "scopes": ["openid","profile","email"], "providerOptions": {"isLinkingAllowed": true, "isCreationAllowed": true, "isAutoCreation": true, "isAutoUpdate": true}}}`. Others: `/management/v1/idps/github`, `/azure`, `/gitlab`, `/generic_oidc`, … (Zitadel management API, "Identity Providers").
- Then enable it on the login policy: `GET /management/v1/policies/login`; if it's the default (no custom policy yet), `POST /management/v1/policies/login` with that policy; then `POST /management/v1/policies/login/idps` with `{"idpId": "<id>", "ownerType": "IDP_OWNER_TYPE_ORG"}`. Also make sure `allowExternalIdp` is true on the policy.
- Check with `POST /management/v1/idps/_search` and tell the user to try signing in at the identity console URL.

## Then
Offer the next step: setting up a service, e.g. the **cms-agent-setup** skill.
