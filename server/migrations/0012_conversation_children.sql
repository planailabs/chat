-- Sub-agents the assistant spawns (subnet `spawn_agent`): their calls are
-- the conversation's (approvals, pages, the user's services), and they are
-- known here from the parent's `child_spawned` event on.
CREATE TABLE conversation_children (
    agent_id text PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    parent_agent_id text NOT NULL,
    -- Its report reached the parent: nothing of it waits on the user any more.
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_children_conversation ON conversation_children (conversation_id);
