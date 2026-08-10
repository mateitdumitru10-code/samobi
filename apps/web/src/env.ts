import { z } from 'zod'

/**
 * Frontend configuration.
 *
 * Only the anon key belongs here, and only for authentication. Every business
 * query goes through the Fastify API. A VITE_-prefixed variable is compiled
 * into the bundle and is therefore public — the service role key must never
 * appear in this file or anywhere else under apps/web.
 */
const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_API_URL: z.string().url().default('http://localhost:3000'),
})

export const env = schema.parse(import.meta.env)
