-- Conversation agents the chat quick-paused before a restart (of the chat or
-- the hub), to resume once it follows the hub again.
CREATE TABLE paused_for_restart (
    agent_id text PRIMARY KEY,
    paused_at timestamptz NOT NULL DEFAULT now()
);
