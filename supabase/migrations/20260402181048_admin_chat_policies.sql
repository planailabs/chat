
  create policy "Admins can read all chat messages"
  on "public"."chat_messages"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_admin() AS is_admin));



  create policy "Admins can read all chat state"
  on "public"."chat_state"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_admin() AS is_admin));



  create policy "Admins can read all token usage"
  on "public"."chat_token_usage"
  as permissive
  for select
  to authenticated
using (( SELECT private.is_admin() AS is_admin));



  create policy "Admins can update all profiles"
  on "public"."profiles"
  as permissive
  for update
  to authenticated
using (( SELECT private.is_admin() AS is_admin))
with check (( SELECT private.is_admin() AS is_admin));



