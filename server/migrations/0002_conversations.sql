-- Many conversations per user (like ChatGPT) with one assistant, instead of
-- one conversation per (user, mode).

create table conversations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references accounts.users (id) on delete cascade,
    -- The subagent-net agent holding the conversation.
    agent_id text not null unique,
    title text not null default '',
    -- "Approve all for this conversation": the approval hook skips the user.
    auto_approve boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index conversations_user on conversations (user_id, updated_at desc);

insert into conversations (user_id, agent_id, title, auto_approve, created_at, updated_at)
select a.user_id, a.agent_id,
       coalesce((select left(m.content, 60) from chat_messages m where m.agent_id = a.agent_id and m.role = 'user' order by m.seq limit 1), ''),
       a.auto_approve, a.created_at, a.created_at
from chat_agents a;

drop table chat_agents;

alter table chat_messages drop column mode;
alter table chat_token_usage drop column mode;

-- One extension per user: modes' texts joined.
create table prompt_extensions (
    user_id uuid primary key references accounts.users (id) on delete cascade,
    content text not null,
    updated_at timestamptz not null default now()
);
insert into prompt_extensions (user_id, content, updated_at)
select user_id, string_agg(content, E'\n\n' order by mode), max(updated_at)
from system_prompt_extensions group by user_id;
drop table system_prompt_extensions;
