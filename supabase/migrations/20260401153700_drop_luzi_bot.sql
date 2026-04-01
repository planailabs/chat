-- Delete luzi tables first, using CASCADE to drop dependent objects and policies
DROP TABLE IF EXISTS public.luzi CASCADE;
DROP TABLE IF EXISTS public.whitelist_tg CASCADE;

-- Safely drop the luzi_bot role
DO
$do$
BEGIN
   IF EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'luzi_bot') THEN
      
      -- Revoke privileges owned by the role before dropping
      DROP OWNED BY luzi_bot CASCADE;
      DROP ROLE luzi_bot;
   END IF;
END
$do$;
