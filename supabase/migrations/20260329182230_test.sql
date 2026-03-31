create schema if not exists "private";


  create table "public"."admins" (
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."admins" enable row level security;

CREATE UNIQUE INDEX admins_pkey ON public.admins USING btree (user_id);

alter table "public"."admins" add constraint "admins_pkey" PRIMARY KEY using index "admins_pkey";

alter table "public"."admins" add constraint "admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."admins" validate constraint "admins_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid()
  );
$function$
;

grant delete on table "public"."admins" to "anon";

grant insert on table "public"."admins" to "anon";

grant references on table "public"."admins" to "anon";

grant select on table "public"."admins" to "anon";

grant trigger on table "public"."admins" to "anon";

grant truncate on table "public"."admins" to "anon";

grant update on table "public"."admins" to "anon";

grant delete on table "public"."admins" to "authenticated";

grant insert on table "public"."admins" to "authenticated";

grant references on table "public"."admins" to "authenticated";

grant select on table "public"."admins" to "authenticated";

grant trigger on table "public"."admins" to "authenticated";

grant truncate on table "public"."admins" to "authenticated";

grant update on table "public"."admins" to "authenticated";

grant delete on table "public"."admins" to "service_role";

grant insert on table "public"."admins" to "service_role";

grant references on table "public"."admins" to "service_role";

grant select on table "public"."admins" to "service_role";

grant trigger on table "public"."admins" to "service_role";

grant truncate on table "public"."admins" to "service_role";

grant update on table "public"."admins" to "service_role";


  create policy "Users can check their own admin status"
  on "public"."admins"
  as permissive
  for select
  to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));



  create policy "Admins can read all data export events"
  on "public"."data_export_events"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_admin() AS is_admin));



  create policy "Admins can read all messages"
  on "public"."messages"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_admin() AS is_admin));



  create policy "Admins can read all newsletter events"
  on "public"."newsletter_events"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_admin() AS is_admin));



  create policy "Admins can read all profiles"
  on "public"."profiles"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_admin() AS is_admin));



