import { createClient } from '@supabase/supabase-js'

import { env } from '../env.js'

/**
 * The only Supabase client in the browser, and it holds the anon key.
 *
 * It is used for authentication alone: sessions, refresh, and setting a password
 * from an invitation link. Business data never comes from here — it comes from
 * the Fastify API, which is the only place that can see past RLS.
 *
 * `detectSessionInUrl` is what turns the invitation link's fragment into a
 * session when the employee first arrives.
 */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
