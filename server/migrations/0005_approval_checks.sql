-- What the approval hook decided about each tool call it judged, and why:
-- shown on the approval card (the assistant's reason, the safety check's
-- verdict and reasoning) and kept as an audit trail.
create table approval_checks (
    agent_id text not null,
    call_id text not null,
    tool text not null,
    -- The assistant's `_reason` for the call.
    agent_reason text,
    -- allowed / denied / asked: what the hook answered.
    decision text not null check (decision in ('allowed', 'denied', 'asked')),
    -- The safety check (validator model): approved / rejected / failed;
    -- null when it didn't run (static checks decided, or none configured).
    check_verdict text check (check_verdict in ('approved', 'rejected', 'failed')),
    check_reasoning text,
    created_at timestamptz not null default now(),
    primary key (agent_id, call_id)
);
