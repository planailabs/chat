# Declarative Schemas

SQL source of truth per `docs/supabase/supabase-sql-style-guide.md`.

## Files

| File                      | Content                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `001_core.sql`            | `profiles`, `messages`, `newsletter_events`, `data_export_events`, `touch_updated_at()` |
| `002_dashboard_admin.sql` | `admins`, `private.is_admin()`, admin RLS policies, Realtime on `messages`              |

## Style Guide

- Keep tables in dependency order (references after referenced tables)
- Append new columns to the end of a table definition to minimize diffs
- Use lowercase SQL keywords
