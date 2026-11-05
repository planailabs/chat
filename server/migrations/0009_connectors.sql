-- MCP servers users and teams add themselves (Settings → Connectors), and
-- the OAuth connections to them and to OAuth apps from the config.
-- Secrets (bearer tokens, OAuth tokens, client secrets, PKCE verifiers) are
-- encrypted by the server ([secrets].connector_encryption_key) and never
-- leave it.

CREATE TABLE connectors (
    id uuid PRIMARY KEY,
    -- Every member uses it; only the team's admins change it.
    team_id uuid NOT NULL REFERENCES accounts.teams (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
    description text NOT NULL DEFAULT '',
    url text NOT NULL,
    auth text NOT NULL CHECK (auth IN ('bearer', 'oauth', 'none')),
    -- OAuth: one connection for the team, or one per member.
    oauth_mode text CHECK (oauth_mode IN ('shared', 'per_member')),
    bearer_token bytea,
    -- What the API shows instead of the token: its last 4 characters, or "set".
    token_hint text,
    created_by uuid REFERENCES accounts.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, name),
    CHECK ((auth = 'oauth') = (oauth_mode IS NOT NULL)),
    CHECK ((auth = 'bearer') = (bearer_token IS NOT NULL))
);

-- `connector` below is 'c:<connectors.id>' or 'app:<[[apps]] name>';
-- connector_id is set for the first, so deleting a connector deletes them.

-- What discovery and dynamic client registration gave, per connector.
CREATE TABLE connector_oauth_clients (
    connector text PRIMARY KEY,
    connector_id uuid REFERENCES connectors (id) ON DELETE CASCADE,
    -- Registered for this MCP URL; another URL means registering again.
    mcp_url text NOT NULL,
    -- Resource, authorization server endpoints, scope (no secrets).
    discovery jsonb NOT NULL,
    client_id text NOT NULL,
    client_secret bytea,
    auth_method text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connector_connections (
    id uuid PRIMARY KEY,
    connector text NOT NULL,
    connector_id uuid REFERENCES connectors (id) ON DELETE CASCADE,
    -- NULL: the team's shared connection.
    user_id uuid REFERENCES accounts.users (id) ON DELETE CASCADE,
    connected_by uuid REFERENCES accounts.users (id) ON DELETE SET NULL,
    access_token bytea NOT NULL,
    refresh_token bytea,
    expires_at timestamptz,
    -- needs_reconnect: the service refused the token, or refreshing failed.
    status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reconnect')),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX connector_connections_one ON connector_connections (connector, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX connector_connections_user ON connector_connections (user_id);

-- OAuth flows under way (ten minutes at most), bound to the user and to
-- the browser that started them (a cookie whose hash is browser_hash).
CREATE TABLE connector_oauth_states (
    state_hash text PRIMARY KEY,
    connector text NOT NULL,
    user_id uuid NOT NULL REFERENCES accounts.users (id) ON DELETE CASCADE,
    shared boolean NOT NULL,
    browser_hash text NOT NULL,
    code_verifier bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
