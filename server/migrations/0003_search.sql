-- Search across a user's own conversations: full text over what was said.
-- 'simple' configuration: no stemming, works the same for English and German.
create index chat_messages_search on chat_messages
    using gin (to_tsvector('simple', content))
    where role in ('user', 'assistant');

create index conversations_title_search on conversations
    using gin (to_tsvector('simple', title));
