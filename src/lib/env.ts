/**
 * Server-side environment variables.
 *
 * In dev mode Astro/Vite may not expose non-prefixed vars via process.env
 * reliably. We optionally load dotenv so .env.local values are always
 * available at runtime — the import is a no-op if dotenv isn't installed.
 */

try {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
} catch {
  // dotenv not installed — rely on the host environment
}

export const env = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  MAC_MGMT_URL: process.env.MAC_MGMT_URL ?? '',
} as const;
