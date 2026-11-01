-- A conversation outlives its agents: when the cluster's agent type changes,
-- subnet only resumes an agent once it's upgraded, which copies its history
-- into a new agent. The conversation then points at the new one, keeps the
-- old ones (their mirrored messages), and the new agent's copied history
-- (events up to mirror_from_seq) isn't mirrored twice.
alter table conversations
    add column previous_agents text[] not null default '{}',
    add column mirror_from_seq bigint not null default 0;
