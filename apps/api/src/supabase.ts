import { createClient } from '@supabase/supabase-js'

import { env } from './env.js'

/**
 * Admin client. Holds the service role key, which bypasses RLS entirely, and
 * therefore exists only inside apps/api. It is used for user administration —
 * invitations, bans — not for reading business data.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * Anonymous client, used server-side only to exchange credentials for a session
 * so that both successful and failed logins can be audited. It has no more power
 * than the browser would have.
 */
export const supabaseAnon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
