import { clientSql } from '../src/db.js'
import { BUCKET_EXPORTURI } from '../src/export/stocare.js'
import { supabaseAdmin } from '../src/supabase.js'

/**
 * Removes every bon and every export batch. For clearing trial data before the
 * factory starts issuing real documents.
 *
 * There is no undo. Recipes, models, dimensions and the SAGA catalogue are left
 * alone — this only takes the documents. The audit log keeps its trace either
 * way: it is append-only by trigger, and that is the point of it.
 *
 *   pnpm --filter @samobi/api sterge-bonuri
 *   pnpm --filter @samobi/api sterge-bonuri -- --scrie
 */

const scrie = process.argv.slice(2).includes('--scrie')

const bonuri = await clientSql<
  { id: string; data: string; cantitate: string; status: string; model: string }[]
>`
  select o.id, o.data, o.cantitate, o.status, m.cod as model
  from production_order o join model m on m.id = o.model_id
  order by o.data`

const loturi = await clientSql<{ id: string; storage_path: string | null; cand: string }[]>`
  select id, storage_path, to_char(generat_la, 'YYYY-MM-DD HH24:MI') as cand
  from export_batch order by generat_la`

const [linii] = await clientSql<{ n: number }[]>`select count(*)::int n from production_order_line`

console.log(`${bonuri.length} bonuri, ${linii?.n ?? 0} linii de consum, ${loturi.length} loturi de export.\n`)
for (const b of bonuri) {
  console.log(`  ${b.data}  ${b.model.padEnd(24)} ${Number(b.cantitate)} buc  ${b.status}`)
}
console.log()
for (const l of loturi) console.log(`  ${l.cand}  ${l.storage_path ?? '—'}`)

if (bonuri.length === 0 && loturi.length === 0) {
  console.log('\nNimic de șters.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

if (!scrie) {
  console.log('\nNimic șters. Rulează din nou cu --scrie.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

const caile = loturi.map((l) => l.storage_path).filter((c): c is string => c !== null)
if (caile.length > 0) {
  const { error } = await supabaseAdmin.storage.from(BUCKET_EXPORTURI).remove(caile)
  if (error !== null) console.error(`Fișierele din bucket: ${error.message}`)
}

// Bons before batches: `production_order_export_coerent` forbids an exported
// bon whose batch has gone.
await clientSql`delete from production_order_line`
await clientSql`delete from production_order`
await clientSql`delete from export_batch`

console.log(`\n${bonuri.length} bonuri, ${linii?.n ?? 0} linii și ${loturi.length} loturi șterse.`)
console.log('Rețetele, modelele, dimensiunile și nomenclatorul au rămas neatinse.')
console.log('Jurnalul de audit păstrează urma — e append-only, prin construcție.')

await clientSql.end({ timeout: 10 })
