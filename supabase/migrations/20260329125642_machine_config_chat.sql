
  create table "public"."machine_config_chat" (
    "user_id" uuid not null,
    "messages" jsonb not null default '[]'::jsonb,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."machine_config_chat" enable row level security;

CREATE UNIQUE INDEX machine_config_chat_pkey ON public.machine_config_chat USING btree (user_id);

alter table "public"."machine_config_chat" add constraint "machine_config_chat_pkey" PRIMARY KEY using index "machine_config_chat_pkey";

alter table "public"."machine_config_chat" add constraint "machine_config_chat_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."machine_config_chat" validate constraint "machine_config_chat_user_id_fkey";

grant delete on table "public"."machine_config_chat" to "anon";

grant insert on table "public"."machine_config_chat" to "anon";

grant references on table "public"."machine_config_chat" to "anon";

grant select on table "public"."machine_config_chat" to "anon";

grant trigger on table "public"."machine_config_chat" to "anon";

grant truncate on table "public"."machine_config_chat" to "anon";

grant update on table "public"."machine_config_chat" to "anon";

grant delete on table "public"."machine_config_chat" to "authenticated";

grant insert on table "public"."machine_config_chat" to "authenticated";

grant references on table "public"."machine_config_chat" to "authenticated";

grant select on table "public"."machine_config_chat" to "authenticated";

grant trigger on table "public"."machine_config_chat" to "authenticated";

grant truncate on table "public"."machine_config_chat" to "authenticated";

grant update on table "public"."machine_config_chat" to "authenticated";

grant delete on table "public"."machine_config_chat" to "service_role";

grant insert on table "public"."machine_config_chat" to "service_role";

grant references on table "public"."machine_config_chat" to "service_role";

grant select on table "public"."machine_config_chat" to "service_role";

grant trigger on table "public"."machine_config_chat" to "service_role";

grant truncate on table "public"."machine_config_chat" to "service_role";

grant update on table "public"."machine_config_chat" to "service_role";


  create policy "Machine config chat deletable by owner"
  on "public"."machine_config_chat"
  as permissive
  for delete
  to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));



  create policy "Machine config chat insertable by owner"
  on "public"."machine_config_chat"
  as permissive
  for insert
  to authenticated
with check ((( SELECT auth.uid() AS uid) = user_id));



  create policy "Machine config chat readable by owner"
  on "public"."machine_config_chat"
  as permissive
  for select
  to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));



  create policy "Machine config chat updatable by owner"
  on "public"."machine_config_chat"
  as permissive
  for update
  to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));


CREATE TRIGGER machine_config_chat_set_updated_at BEFORE UPDATE ON public.machine_config_chat FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


