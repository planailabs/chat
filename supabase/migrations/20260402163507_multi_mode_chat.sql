-- Multi-mode chat migration
-- 1. Create new generic tables
-- 2. Copy existing machine_config data
-- 3. Drop old dedicated tables

-- ─── Step 1: Create new generic tables ──────────────────────────────────────

create table "public"."chat_messages" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null,
  "mode" text not null,
  "role" text not null,
  "content" text not null,
  "content_blocks" jsonb,
  "ordinal" integer not null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
);

alter table "public"."chat_messages" enable row level security;

create table "public"."chat_state" (
  "user_id" uuid not null,
  "mode" text not null,
  "phase" text not null default 'idle'::text,
  "pending_question" jsonb,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
);

alter table "public"."chat_state" enable row level security;

create table "public"."chat_token_usage" (
  "id" uuid not null default gen_random_uuid(),
  "user_id" uuid not null,
  "mode" text not null,
  "input_tokens" integer not null default 0,
  "output_tokens" integer not null default 0,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
);

alter table "public"."chat_token_usage" enable row level security;

-- Indexes
CREATE UNIQUE INDEX chat_messages_pkey ON public.chat_messages USING btree (id);
CREATE UNIQUE INDEX chat_messages_user_mode_ordinal ON public.chat_messages USING btree (user_id, mode, ordinal);
CREATE INDEX chat_messages_user_mode_ordinal_idx ON public.chat_messages USING btree (user_id, mode, ordinal);
CREATE UNIQUE INDEX chat_state_pkey ON public.chat_state USING btree (user_id, mode);
CREATE UNIQUE INDEX chat_token_usage_pkey ON public.chat_token_usage USING btree (id);
CREATE INDEX chat_token_usage_user_time_idx ON public.chat_token_usage USING btree (user_id, created_at);

-- Primary keys
alter table "public"."chat_messages" add constraint "chat_messages_pkey" PRIMARY KEY using index "chat_messages_pkey";
alter table "public"."chat_state" add constraint "chat_state_pkey" PRIMARY KEY using index "chat_state_pkey";
alter table "public"."chat_token_usage" add constraint "chat_token_usage_pkey" PRIMARY KEY using index "chat_token_usage_pkey";

-- Constraints
alter table "public"."chat_messages" add constraint "chat_messages_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'cancel'::text]))) not valid;
alter table "public"."chat_messages" validate constraint "chat_messages_role_check";
alter table "public"."chat_messages" add constraint "chat_messages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."chat_messages" validate constraint "chat_messages_user_id_fkey";
alter table "public"."chat_messages" add constraint "chat_messages_user_mode_ordinal" UNIQUE using index "chat_messages_user_mode_ordinal";

alter table "public"."chat_state" add constraint "chat_state_phase_check" CHECK ((phase = ANY (ARRAY['idle'::text, 'waiting_for_answer'::text, 'tool_pending'::text]))) not valid;
alter table "public"."chat_state" validate constraint "chat_state_phase_check";
alter table "public"."chat_state" add constraint "chat_state_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."chat_state" validate constraint "chat_state_user_id_fkey";

alter table "public"."chat_token_usage" add constraint "chat_token_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."chat_token_usage" validate constraint "chat_token_usage_user_id_fkey";

-- Trigger
CREATE TRIGGER chat_state_set_updated_at BEFORE UPDATE ON public.chat_state FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Grants
grant delete on table "public"."chat_messages" to "anon";
grant insert on table "public"."chat_messages" to "anon";
grant references on table "public"."chat_messages" to "anon";
grant select on table "public"."chat_messages" to "anon";
grant trigger on table "public"."chat_messages" to "anon";
grant truncate on table "public"."chat_messages" to "anon";
grant update on table "public"."chat_messages" to "anon";
grant delete on table "public"."chat_messages" to "authenticated";
grant insert on table "public"."chat_messages" to "authenticated";
grant references on table "public"."chat_messages" to "authenticated";
grant select on table "public"."chat_messages" to "authenticated";
grant trigger on table "public"."chat_messages" to "authenticated";
grant truncate on table "public"."chat_messages" to "authenticated";
grant update on table "public"."chat_messages" to "authenticated";
grant delete on table "public"."chat_messages" to "service_role";
grant insert on table "public"."chat_messages" to "service_role";
grant references on table "public"."chat_messages" to "service_role";
grant select on table "public"."chat_messages" to "service_role";
grant trigger on table "public"."chat_messages" to "service_role";
grant truncate on table "public"."chat_messages" to "service_role";
grant update on table "public"."chat_messages" to "service_role";

grant delete on table "public"."chat_state" to "anon";
grant insert on table "public"."chat_state" to "anon";
grant references on table "public"."chat_state" to "anon";
grant select on table "public"."chat_state" to "anon";
grant trigger on table "public"."chat_state" to "anon";
grant truncate on table "public"."chat_state" to "anon";
grant update on table "public"."chat_state" to "anon";
grant delete on table "public"."chat_state" to "authenticated";
grant insert on table "public"."chat_state" to "authenticated";
grant references on table "public"."chat_state" to "authenticated";
grant select on table "public"."chat_state" to "authenticated";
grant trigger on table "public"."chat_state" to "authenticated";
grant truncate on table "public"."chat_state" to "authenticated";
grant update on table "public"."chat_state" to "authenticated";
grant delete on table "public"."chat_state" to "service_role";
grant insert on table "public"."chat_state" to "service_role";
grant references on table "public"."chat_state" to "service_role";
grant select on table "public"."chat_state" to "service_role";
grant trigger on table "public"."chat_state" to "service_role";
grant truncate on table "public"."chat_state" to "service_role";
grant update on table "public"."chat_state" to "service_role";

grant delete on table "public"."chat_token_usage" to "anon";
grant insert on table "public"."chat_token_usage" to "anon";
grant references on table "public"."chat_token_usage" to "anon";
grant select on table "public"."chat_token_usage" to "anon";
grant trigger on table "public"."chat_token_usage" to "anon";
grant truncate on table "public"."chat_token_usage" to "anon";
grant update on table "public"."chat_token_usage" to "anon";
grant delete on table "public"."chat_token_usage" to "authenticated";
grant insert on table "public"."chat_token_usage" to "authenticated";
grant references on table "public"."chat_token_usage" to "authenticated";
grant select on table "public"."chat_token_usage" to "authenticated";
grant trigger on table "public"."chat_token_usage" to "authenticated";
grant truncate on table "public"."chat_token_usage" to "authenticated";
grant update on table "public"."chat_token_usage" to "authenticated";
grant delete on table "public"."chat_token_usage" to "service_role";
grant insert on table "public"."chat_token_usage" to "service_role";
grant references on table "public"."chat_token_usage" to "service_role";
grant select on table "public"."chat_token_usage" to "service_role";
grant trigger on table "public"."chat_token_usage" to "service_role";
grant truncate on table "public"."chat_token_usage" to "service_role";
grant update on table "public"."chat_token_usage" to "service_role";

-- RLS policies
create policy "Chat messages deletable by owner" on "public"."chat_messages" as permissive for delete to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Chat messages insertable by owner" on "public"."chat_messages" as permissive for insert to authenticated with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Chat messages readable by owner" on "public"."chat_messages" as permissive for select to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Chat messages updatable by owner" on "public"."chat_messages" as permissive for update to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));

create policy "Chat state deletable by owner" on "public"."chat_state" as permissive for delete to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Chat state insertable by owner" on "public"."chat_state" as permissive for insert to authenticated with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Chat state readable by owner" on "public"."chat_state" as permissive for select to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Chat state updatable by owner" on "public"."chat_state" as permissive for update to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));

create policy "Token usage readable by owner" on "public"."chat_token_usage" as permissive for select to authenticated using ((( SELECT auth.uid() AS uid) = user_id));

-- ─── Step 2: Copy existing data from old tables ────────────────────────────

insert into public.chat_state (user_id, mode, phase, pending_question, created_at, updated_at)
select user_id, 'machine_config', phase, pending_question, created_at, updated_at
from public.machine_config_state
on conflict (user_id, mode) do nothing;

insert into public.chat_messages (id, user_id, mode, role, content, content_blocks, ordinal, created_at)
select id, user_id, 'machine_config', role, content, content_blocks, ordinal, created_at
from public.machine_config_messages
on conflict (id) do nothing;

-- ─── Step 3: Drop old dedicated tables ──────────────────────────────────────

drop trigger if exists "machine_config_state_set_updated_at" on "public"."machine_config_state";

drop policy "Machine config messages deletable by owner" on "public"."machine_config_messages";
drop policy "Machine config messages insertable by owner" on "public"."machine_config_messages";
drop policy "Machine config messages readable by owner" on "public"."machine_config_messages";
drop policy "Machine config messages updatable by owner" on "public"."machine_config_messages";
drop policy "Machine config state deletable by owner" on "public"."machine_config_state";
drop policy "Machine config state insertable by owner" on "public"."machine_config_state";
drop policy "Machine config state readable by owner" on "public"."machine_config_state";
drop policy "Machine config state updatable by owner" on "public"."machine_config_state";

revoke all on table "public"."machine_config_messages" from "anon", "authenticated", "service_role";
revoke all on table "public"."machine_config_state" from "anon", "authenticated", "service_role";

drop table "public"."machine_config_messages";
drop table "public"."machine_config_state";
