# Supabase Workspace

Declarative workflow per [SUPABASE_SETUP.md](../SUPABASE_SETUP.md) and `docs/supabase/`.

## Environments

| Environment     | Project ID             | Dashboard                                                           |
| --------------- | ---------------------- | ------------------------------------------------------------------- |
| **Production**  | `tlssdiqdokctvxcezptr` | [Link](https://supabase.com/dashboard/project/tlssdiqdokctvxcezptr) |
| **Development** | `kjjhnyztaynggfnipnpb` | [Link](https://supabase.com/dashboard/project/kjjhnyztaynggfnipnpb) |

## Structure

```
supabase/
  schemas/      # Source of truth (see schemas/README.md)
  migrations/   # Auto-generated history
```

## Database Roles

| Role            | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `authenticated` | Logged-in users, RLS-governed                             |
| `anon`          | No access (all policies require auth)                     |
| `service_role`  | Bypasses RLS (admin ops only)                             |
| `luzi_bot`      | Telegram bot: SELECT `whitelist_tg`, SELECT/INSERT `luzi` |

## Workflow

1. Edit files in `schemas/`
2. `pnpm supabase db diff -f migration_name`
3. Apply and verify on development

## Linking

```bash
pnpm supabase login
pnpm supabase link --project-ref kjjhnyztaynggfnipnpb
```

Creates `config.toml` (do not commit).
