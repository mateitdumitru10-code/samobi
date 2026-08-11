import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { recipe, recipeLine } from '@samobi/shared/db'
import { and, eq, sql } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'

/**
 * Re-points recipe lines from a generic article to the one SAGA actually
 * consumes.
 *
 * The evidence is the recipes imported from SAGA's own production reports: if
 * thirty-five of thirty-eight products consume ADEZIV WELLBOND W-115, then the
 * line reading „ADEZIV" means that. Where the reports do not settle it — three
 * kinds of CHERESTEA at ten, nine and nine — nothing is written, because the
 * source of truth is silent, not ambiguous in a way a script may resolve.
 *
 * Only lines transcribed from the paper sheets are touched. The lines that came
 * from SAGA are the evidence and are left exactly as they are.
 *
 *   pnpm --filter @samobi/api aplica-gestiune-gresita
 *   pnpm --filter @samobi/api aplica-gestiune-gresita -- --scrie
 */

const CALE_MAPARI = resolve(import.meta.dirname, 'mapari.json')
const scrie = process.argv.slice(2).includes('--scrie')

/** How far ahead the first candidate must be before it counts as settled. */
const DOMINANTA = 3

/**
 * Units that are the same measure written two ways. Everything else is a real
 * difference: SAIBA is counted in hundreds on the sheets and in thousands in
 * SAGA, and swapping the article without touching the quantity would book ten
 * times too little.
 */
const ACEEASI_UNITATE: readonly (readonly string[])[] = [['M', 'ML', 'ml']]

function unitatiCompatibile(a: string, b: string): boolean {
  const x = a.trim().toUpperCase()
  const y = b.trim().toUpperCase()
  if (x === y) return true
  return ACEEASI_UNITATE.some((grup) => grup.includes(x) && grup.includes(y))
}

interface Suspect {
  cod_saga: string
  denumire: string
  gestiune: string
  linii: number
  unitati: string
}

const suspecti = await clientSql<Suspect[]>`
  select rl.cod_saga, a.denumire,
         coalesce(a.gestiune_implicita, '(fără gestiune)') as gestiune,
         count(*)::int as linii,
         string_agg(distinct rl.um, '/' order by rl.um) as unitati
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  where coalesce(a.gestiune_implicita, '') <> 'MATERII PRIME'
    and (rl.observatii is null or rl.observatii not like 'din SAGA%')
  group by rl.cod_saga, a.denumire, a.gestiune_implicita
  order by count(*) desc`

const folosite = await clientSql<{
  cod_saga: string
  denumire: string
  um: string
  retete: number
}[]>`
  select rl.cod_saga, a.denumire, rl.um, count(distinct rl.recipe_id)::int as retete
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  where rl.observatii like 'din SAGA%'
  group by rl.cod_saga, a.denumire, rl.um
  order by count(distinct rl.recipe_id) desc`

function radacina(denumire: string): string {
  return (denumire.trim().toUpperCase().split(/[\s,./-]+/)[0] ?? '').slice(0, 8)
}

interface Decizie {
  vechi: string
  denumireVeche: string
  nou: string
  denumireNoua: string
  retete: number
  um: string
}

const decise: Decizie[] = []
const nedecise: { s: Suspect; motiv: string }[] = []

for (const s of suspecti) {
  const candidati = folosite.filter((f) => radacina(f.denumire) === radacina(s.denumire))

  const primul = candidati[0]
  if (primul === undefined) {
    nedecise.push({ s, motiv: 'niciun articol cu aceeași rădăcină în rețetele din SAGA' })
    continue
  }

  const alDoilea = candidati[1]
  if (alDoilea !== undefined && primul.retete < alDoilea.retete * DOMINANTA) {
    nedecise.push({
      s,
      motiv:
        `mai mulți candidați apropiați: ${candidati
          .slice(0, 3)
          .map((c) => `${c.denumire} (${c.retete})`)
          .join(', ')}`,
    })
    continue
  }

  const unitatiFisa = s.unitati.split('/')
  const nepotrivite = unitatiFisa.filter((u) => !unitatiCompatibile(u, primul.um))
  if (nepotrivite.length > 0) {
    nedecise.push({
      s,
      motiv:
        `fișa dă ${s.unitati}, SAGA consumă în ${primul.um} — cantitatea ar însemna ` +
        'altceva, nu doar alt cod',
    })
    continue
  }

  decise.push({
    vechi: s.cod_saga,
    denumireVeche: s.denumire,
    nou: primul.cod_saga,
    denumireNoua: primul.denumire,
    retete: primul.retete,
    um: primul.um,
  })
}

console.log(`${decise.length} articole cu un înlocuitor clar:\n`)
for (const d of decise) {
  console.log(
    `  ${d.denumireVeche.padEnd(18)} ${d.vechi}  →  ${d.nou}  ` +
      `${d.denumireNoua.slice(0, 38).padEnd(39)} ${d.retete} rețete`,
  )
}

console.log(`\n${nedecise.length} rămân de decis:\n`)
for (const n of nedecise) {
  console.log(`  ${n.s.denumire.padEnd(18)} ${n.s.cod_saga}  ${n.s.linii} linii — ${n.motiv}`)
}

if (decise.length === 0 || !scrie) {
  console.log('\nNimic scris. Rulează din nou cu --scrie.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

/** Where each line sits, so the decision survives a reload of the sheets. */
const afectate = await clientSql<{ model: string; nr_linie: number; cod_saga: string }[]>`
  select m.cod as model, rl.nr_linie, rl.cod_saga
  from recipe_line rl
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where rl.cod_saga = any(${clientSql.array(decise.map((d) => d.vechi))}::text[])
    and (rl.observatii is null or rl.observatii not like 'din SAGA%')`

const nou = new Map(decise.map((d) => [d.vechi, d.nou]))

let linii = 0
await db.transaction(async (tx) => {
  for (const d of decise) {
    const rezultat = await tx
      .update(recipeLine)
      .set({ codSaga: d.nou })
      .where(
        and(
          eq(recipeLine.codSaga, d.vechi),
          // Parentheses matter: without them the OR swallows the code test and
          // the update reaches every line that is not from SAGA. The CHECK on
          // variable lines is what caught it.
          sql`(${recipeLine.observatii} is null or ${recipeLine.observatii} not like 'din SAGA%')`,
          eq(recipeLine.esteVariabil, false),
        ),
      )
      .returning({ id: recipeLine.id })
    linii += rezultat.length
  }

  // Anyone editing one of these recipes is now looking at different articles.
  await tx.execute(
    sql`update ${recipe} set lock_version = lock_version + 1
        where id in (select recipe_id from recipe_line
                      where cod_saga = any(${sql.raw(
                        `ARRAY[${decise.map((d) => `'${d.nou}'`).join(',')}]::text[]`,
                      )}))`,
  )
})

// The sheets are still the source for these models, so the decision is recorded
// where a reload will read it back.
const anterioare: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(CALE_MAPARI, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
})()

for (const a of afectate) {
  const inlocuitor = nou.get(a.cod_saga)
  if (inlocuitor !== undefined) anterioare[`${a.model}#${a.nr_linie}`] = inlocuitor
}
writeFileSync(CALE_MAPARI, `${JSON.stringify(anterioare, null, 2)}\n`)

console.log(`\n${linii} linii de rețetă mutate pe articolele din SAGA.`)
console.log(`${afectate.length} decizii scrise în scripts/mapari.json, ca să reziste la reîncărcare.`)

await clientSql.end({ timeout: 10 })
