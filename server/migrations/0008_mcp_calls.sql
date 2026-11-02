-- What happened to each call an outside MCP client made through /public/mcp:
-- allowed (by which layer), refused, confirmed or declined by the user.
CREATE TABLE mcp_calls (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL,
    client text NOT NULL,
    tool text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('allow', 'deny')),
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_calls_user ON mcp_calls (user_id, created_at DESC);
