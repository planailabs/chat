-- Cache token tracking columns for prompt caching observability.

set search_path = public;

alter table public.chat_token_usage
  add column if not exists cache_creation_input_tokens integer not null default 0,
  add column if not exists cache_read_input_tokens     integer not null default 0;
