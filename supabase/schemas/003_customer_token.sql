-- 005: Add customer_token column to profiles
-- Nullable text column for mac-mgmt setting API token.
-- Admin-set only; users can read their own value via existing RLS policies.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS customer_token text;
