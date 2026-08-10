import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Vitest does not read .env. Tests that touch the database need the real
// connection strings; unit tests only need `src/env.ts` to validate.
const caleEnv = resolve(import.meta.dirname, '..', '.env')
if (existsSync(caleEnv)) {
  for (const rand of readFileSync(caleEnv, 'utf8').split('\n')) {
    const potrivire = /^([A-Z0-9_]+)=(.*)$/.exec(rand.trim())
    if (potrivire?.[1] !== undefined && process.env[potrivire[1]] === undefined) {
      process.env[potrivire[1]] = potrivire[2]
    }
  }
}

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/postgres'
process.env.DIRECT_URL ??= 'postgresql://postgres:postgres@localhost:5432/postgres'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
