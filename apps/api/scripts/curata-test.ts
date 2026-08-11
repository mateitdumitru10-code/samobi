import { clientSql } from '../src/db.js'
import { BUCKET_EXPORTURI } from '../src/export/stocare.js'
import { supabaseAdmin } from '../src/supabase.js'

/**
 * Sweeps what the test suites leave behind on the live project.
 *
 * There is no local stack, so the tests create real accounts and real rows and
 * remove them afterwards. A run that is killed half-way does not get to the
 * removal, and the leftovers are not inert: an export batch keeps a foreign key
 * on its account, and `deleteUser` then fails quietly, so the account stays for
 * good. Nine had accumulated before anybody noticed them in the users list.
 *
 * Everything here is keyed on `@example.com`, which only a test account has,
 * and on models coded `TEST-%`. Real data matches neither — with one exception
 * that cost this script a rewrite: a real bon turned out to hang off a batch a
 * test account had generated. So nothing here deletes a bon, ever. A batch goes
 * only if no bon points at it, and an account whose batch had to stay is
 * reported rather than forced.
 *
 *   pnpm --filter @samobi/api curata-test
 *   pnpm --filter @samobi/api curata-test -- --scrie
 */

const scrie = process.argv.slice(2).includes('--scrie')

const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
if (error !== null) throw new Error(`Nu am putut citi utilizatorii: ${error.message}`)

const deTest = data.users.filter((u) => (u.email ?? '').endsWith('@example.com'))
const reale = data.users.length - deTest.length

console.log(`${data.users.length} conturi în Supabase Auth: ${reale} reale, ${deTest.length} de test.`)

if (deTest.length === 0) {
  console.log('Nimic de curățat.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

for (const u of deTest) console.log(`  ${u.email}  creat ${u.created_at?.slice(0, 10)}`)

const ids = deTest.map((u) => u.id)

// Only orphans. A batch with a bon behind it is somebody's document, whoever
// generated it, and deleting it would take the bon with it.
const loturi = await clientSql.unsafe<{ id: string; storage_path: string | null }[]>(
  `select e.id, e.storage_path
     from export_batch e
    where e.generat_de = any($1::uuid[])
      and not exists (select 1 from production_order o where o.export_id = e.id)`,
  [ids],
)

const pastrate = await clientSql.unsafe<{ id: string; n: number }[]>(
  `select e.id, count(o.id)::int n
     from export_batch e join production_order o on o.export_id = e.id
    where e.generat_de = any($1::uuid[])
    group by e.id`,
  [ids],
)

const modele = await clientSql<{ id: string; cod: string }[]>`
  select id, cod from model where cod like 'TEST-%'`

console.log(`\n${loturi.length} loturi de export orfane și ${modele.length} modele TEST-% de șters.`)
for (const m of modele) console.log(`  ${m.cod}`)

if (pastrate.length > 0) {
  console.log(
    `\n${pastrate.length} loturi rămân: au bonuri reale în spate. Conturile care le-au ` +
      'generat nu se pot șterge, și e corect așa — bonul contează mai mult decât contul.',
  )
}

if (!scrie) {
  console.log('\nNimic șters. Rulează din nou cu --scrie.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

// Order follows the foreign keys, and `production_order_export_coerent` forbids
// an exported bon without its batch — so the bons go before the batches.
const idModele = modele.map((m) => m.id)

if (idModele.length > 0) {
  await clientSql.unsafe(
    `delete from production_order_line where production_order_id in (
       select id from production_order where model_id = any($1::uuid[]))`,
    [idModele],
  )
  await clientSql.unsafe(`delete from production_order where model_id = any($1::uuid[])`, [idModele])
}

if (loturi.length > 0) {
  const caile = loturi.map((l) => l.storage_path).filter((c): c is string => c !== null)
  if (caile.length > 0) {
    await supabaseAdmin.storage.from(BUCKET_EXPORTURI).remove(caile)
  }
  await clientSql.unsafe(`delete from export_batch where id = any($1::uuid[])`, [
    loturi.map((l) => l.id),
  ])
}

if (idModele.length > 0) {
  await clientSql.unsafe(
    `delete from recipe_line where recipe_id in (
       select id from recipe where model_id = any($1::uuid[]))`,
    [idModele],
  )
  await clientSql.unsafe(`delete from recipe where model_id = any($1::uuid[])`, [idModele])
  await clientSql.unsafe(`delete from dimension where model_id = any($1::uuid[])`, [idModele])
  await clientSql.unsafe(`delete from model where id = any($1::uuid[])`, [idModele])
}

let sterse = 0
for (const u of deTest) {
  const { error: eroareStergere } = await supabaseAdmin.auth.admin.deleteUser(u.id)
  if (eroareStergere !== null) {
    // Almost always a foreign key that is right to be there.
    console.error(`  ${u.email}: rămâne — ${eroareStergere.message}`)
    continue
  }
  sterse += 1
}

console.log(`\n${sterse} conturi șterse din ${deTest.length}.`)
console.log('Jurnalul de audit rămâne — e append-only, prin construcție.')

await clientSql.end({ timeout: 10 })
