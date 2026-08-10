import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import postgres from 'postgres'

/**
 * Applies supabase/seed.sql to the configured project.
 *
 * Deliberately manual: there is one Supabase project and it is also production,
 * so example data only ever arrives because someone asked for it. The script is
 * idempotent, and runs in a single transaction so a failure leaves nothing
 * behind.
 */

const url = process.env.DIRECT_URL
if (url === undefined || url === '') {
  console.error('DIRECT_URL lipsește. Rulează cu variabilele din apps/api/.env încărcate.')
  process.exit(1)
}

const cale = resolve(import.meta.dirname, '..', '..', '..', 'supabase', 'seed.sql')
const seed = readFileSync(cale, 'utf8')

const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, onnotice: () => {} })

try {
  await sql.begin(async (tx) => {
    await tx.unsafe(seed)
  })
  const [modele] = await sql`select count(*)::int as n from model`
  const [articole] = await sql`select count(*)::int as n from saga_article`
  console.log(`Seed aplicat. Modele: ${modele?.['n']}, articole: ${articole?.['n']}.`)
} catch (err) {
  console.error('Seed eșuat:', (err as Error).message)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
