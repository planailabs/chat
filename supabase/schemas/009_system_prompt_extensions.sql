-- 009: System prompt extensions per user and chat mode
-- Admin-set custom text appended to the built-in system prompt.

CREATE TABLE public.system_prompt_extensions (
  user_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode       text    NOT NULL,
  content    text    NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, mode)
);

-- Auto-update updated_at
CREATE TRIGGER system_prompt_extensions_set_updated_at
  BEFORE UPDATE ON public.system_prompt_extensions
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- RLS: deny by default, admin full access (service role bypasses)
ALTER TABLE public.system_prompt_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all ON public.system_prompt_extensions
  FOR ALL USING (private.is_admin());
