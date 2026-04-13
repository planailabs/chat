create extension if not exists "pg_net" with schema "extensions";


  create table "public"."system_prompt_extensions" (
    "user_id" uuid not null,
    "mode" text not null,
    "content" text not null default ''::text,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."system_prompt_extensions" enable row level security;

CREATE UNIQUE INDEX system_prompt_extensions_pkey ON public.system_prompt_extensions USING btree (user_id, mode);

alter table "public"."system_prompt_extensions" add constraint "system_prompt_extensions_pkey" PRIMARY KEY using index "system_prompt_extensions_pkey";

alter table "public"."system_prompt_extensions" add constraint "system_prompt_extensions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."system_prompt_extensions" validate constraint "system_prompt_extensions_user_id_fkey";

grant delete on table "public"."system_prompt_extensions" to "anon";

grant insert on table "public"."system_prompt_extensions" to "anon";

grant references on table "public"."system_prompt_extensions" to "anon";

grant select on table "public"."system_prompt_extensions" to "anon";

grant trigger on table "public"."system_prompt_extensions" to "anon";

grant truncate on table "public"."system_prompt_extensions" to "anon";

grant update on table "public"."system_prompt_extensions" to "anon";

grant delete on table "public"."system_prompt_extensions" to "authenticated";

grant insert on table "public"."system_prompt_extensions" to "authenticated";

grant references on table "public"."system_prompt_extensions" to "authenticated";

grant select on table "public"."system_prompt_extensions" to "authenticated";

grant trigger on table "public"."system_prompt_extensions" to "authenticated";

grant truncate on table "public"."system_prompt_extensions" to "authenticated";

grant update on table "public"."system_prompt_extensions" to "authenticated";

grant delete on table "public"."system_prompt_extensions" to "service_role";

grant insert on table "public"."system_prompt_extensions" to "service_role";

grant references on table "public"."system_prompt_extensions" to "service_role";

grant select on table "public"."system_prompt_extensions" to "service_role";

grant trigger on table "public"."system_prompt_extensions" to "service_role";

grant truncate on table "public"."system_prompt_extensions" to "service_role";

grant update on table "public"."system_prompt_extensions" to "service_role";


  create policy "admin_all"
  on "public"."system_prompt_extensions"
  as permissive
  for all
  to public
using (private.is_admin());


CREATE TRIGGER system_prompt_extensions_set_updated_at BEFORE UPDATE ON public.system_prompt_extensions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


