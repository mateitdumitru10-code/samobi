import { z } from 'zod'

/**
 * Runtime configuration for the API.
 *
 * DATABASE_URL and DIRECT_URL are deliberately separate: Supabase exposes a
 * transaction-mode pooler for runtime queries and a direct/session connection
 * for DDL. Running migrations through the transaction pooler fails in confusing
 * ways. See CLAUDE.md, "Conexiuni".
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  /** Bypasses RLS entirely. Never leaves apps/api. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  /** Comma-separated list of origins allowed to call the API. */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Configurare invalida in .env:\n${issues}`)
}

export const env = parsed.data
export const allowedOrigins = env.WEB_ORIGIN.split(',').map((o) => o.trim())

/**
 * Where invitation and recovery links land.
 *
 * A path, never a fragment. Supabase appends its own `#access_token=...` to the
 * redirect target, so a URL that already ends in `#/activare` produces
 * `#/activare#access_token=...` — two fragments, which supabase-js cannot parse,
 * and the session is silently never established.
 *
 * This exact string must also appear in `additional_redirect_urls` in
 * supabase/config.toml, otherwise Supabase falls back to the site URL.
 */
export const urlActivare = `${allowedOrigins[0] ?? ''}/activare`
