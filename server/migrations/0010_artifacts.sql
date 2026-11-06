-- Interactive pages in conversations: artifacts the assistant publishes
-- (HTML on the generative-ui suite) and MCP Apps views of service tools
-- (a tool's `ui://` resource with its call's input and result). The browser
-- shows them in a sandboxed iframe; see `artifacts`.

CREATE TABLE artifacts (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES accounts.users (id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('artifact', 'mcp_app')),
    -- The assistant's name for an artifact (publishing it again adds a version);
    -- NULL for MCP Apps views, which are one per tool call.
    name text CHECK (name ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    title text NOT NULL,
    -- MCP Apps views: the service whose tool made it (its tools are the only
    -- ones the view may call).
    service text,
    -- What the page told the assistant (ui/update-model-context), and whether
    -- the next message still has to carry it.
    model_context jsonb,
    context_pending boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, name),
    CHECK ((kind = 'artifact') = (name IS NOT NULL)),
    CHECK ((kind = 'mcp_app') = (service IS NOT NULL))
);
CREATE INDEX artifacts_conversation ON artifacts (conversation_id, created_at);

CREATE TABLE artifact_versions (
    artifact_id uuid NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    html text NOT NULL,
    -- artifact: backflow handlers, action → {lang, source, wall_ms, mem_mb}.
    handlers jsonb NOT NULL DEFAULT '{}',
    -- mcp_app: {tool, arguments, result, csp, permissions}.
    meta jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (artifact_id, version)
);

-- The page's KV view (public: the page reads it; private: handlers and the
-- assistant only).
CREATE TABLE artifact_state (
    artifact_id uuid PRIMARY KEY REFERENCES artifacts (id) ON DELETE CASCADE,
    kv jsonb NOT NULL DEFAULT '{}',
    kv_private jsonb NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- What happened on a page: the user's actions (backflow) and what handlers
-- emitted. The assistant reads them with artifact_events.
CREATE TABLE artifact_events (
    id bigserial PRIMARY KEY,
    artifact_id uuid NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
    version integer,
    source text NOT NULL CHECK (source IN ('user', 'handler')),
    action text NOT NULL,
    value jsonb,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifact_events_unread ON artifact_events (artifact_id, id) WHERE read_at IS NULL;
