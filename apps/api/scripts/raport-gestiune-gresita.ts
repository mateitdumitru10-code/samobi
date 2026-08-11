import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { scorSimilaritate } from '@samobi/shared/nomenclator'
import ExcelJS from 'exceljs'

import { clientSql } from '../src/db.js'

/**
 * Recipe lines pointing at an article this factory does not consume.
 *
 * Every bon SAGA has ever issued discharges from MATERII PRIME — product and
 * materials alike. So a recipe line whose article is filed under MATERIALE
 * CONSUMABILE, IMOBILIZARI IN CURS or nothing at all is not a warehouse
 * problem; it is almost certainly the wrong article. They are the generic
 * codes — CUIE, ADEZIV, PVC — matched from a handwritten name years of stock
 * movements never touched.
 *
 * The replacement is not guessed either: the recipes imported from SAGA say
 * which specific article the workshop actually consumes, and how often.
 *
 *   pnpm --filter @samobi/api raport-gestiune-gresita
 *   pnpm --filter @samobi/api aplica-mapari -- gestiune-gresita.xlsx
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

interface Suspect {
  cod_saga: string
  denumire: string
  um: string
  gestiune: string
  linii: number
  modele: string
}

const suspecti = await clientSql<Suspect[]>`
  select rl.cod_saga,
         a.denumire,
         rl.um,
         coalesce(a.gestiune_implicita, '(fără gestiune)') as gestiune,
         count(*)::int                                     as linii,
         string_agg(distinct m.cod, ', ' order by m.cod)   as modele
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where coalesce(a.gestiune_implicita, '') <> 'MATERII PRIME'
  group by rl.cod_saga, a.denumire, rl.um, a.gestiune_implicita
  order by count(*) desc`

if (suspecti.length === 0) {
  console.log('Nicio linie de rețetă pe un articol din afara gestiunii MATERII PRIME.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

/** What the SAGA-imported recipes actually consume, and in how many of them. */
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
  group by rl.cod_saga, a.denumire, rl.um`

/** The first word is what a handwritten name and a catalogue name share. */
function radacina(denumire: string): string {
  return (denumire.trim().toUpperCase().split(/[\s,./-]+/)[0] ?? '').slice(0, 8)
}

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('Gestiune greșită')

foaie.addRow([
  'Model',
  'Poziția',
  'Material (din fișă)',
  'UM',
  'COD ALES  ← scrie aici',
  'Acum',
  'Gestiune acum',
  'Propunere (din rețetele SAGA)',
  'Rețete',
  'Alternativa 2',
  'Alternativa 3',
])
foaie.getRow(1).font = { bold: true }

let cuPropunere = 0

for (const s of suspecti) {
  const radacinaLui = radacina(s.denumire)

  const candidati = folosite
    .filter((f) => radacina(f.denumire) === radacinaLui)
    .map((f) => ({ ...f, scor: scorSimilaritate(s.denumire, f.denumire) }))
    .sort((a, b) => b.retete - a.retete || b.scor - a.scor)
    .slice(0, 3)

  if (candidati.length > 0) cuPropunere += 1

  const eticheta = (c: (typeof candidati)[number] | undefined): string =>
    c === undefined
      ? ''
      : `${c.cod_saga}  ${c.denumire} (${c.um})  în ${c.retete} rețete`

  // One row per model, so the sheet feeds `aplica-mapari` unchanged.
  for (const modelCod of s.modele.split(', ')) {
    const [pozitie] = await clientSql<{ nr_linie: number }[]>`
      select rl.nr_linie from recipe_line rl
      join recipe r on r.id = rl.recipe_id join model m on m.id = r.model_id
      where m.cod = ${modelCod} and rl.cod_saga = ${s.cod_saga}
      limit 1`

    foaie.addRow([
      modelCod,
      pozitie?.nr_linie ?? '',
      s.denumire,
      s.um,
      '',
      `${s.cod_saga} ${s.denumire}`,
      s.gestiune,
      eticheta(candidati[0]),
      candidati[0]?.retete ?? 0,
      eticheta(candidati[1]),
      eticheta(candidati[2]),
    ])
  }

  console.log(
    `${s.cod_saga}  ${s.denumire.slice(0, 22).padEnd(23)} ${s.um.padEnd(6)} ` +
      `${s.gestiune.padEnd(24)} ${s.linii} linii`,
  )
  for (const c of candidati) {
    console.log(`        → ${c.cod_saga}  ${c.denumire.slice(0, 40).padEnd(41)} ${c.retete} rețete`)
  }
}

foaie.getColumn(2).numFmt = '0'
foaie.getColumn(5).numFmt = '@'
foaie.getColumn(1).width = 26
foaie.getColumn(3).width = 24
foaie.getColumn(5).width = 24
for (const col of [6, 8, 10, 11]) foaie.getColumn(col).width = 52

writeFileSync(
  resolve(DOSAR, 'gestiune-gresita.xlsx'),
  Buffer.from(await registru.xlsx.writeBuffer()),
)

console.log(
  `\n${suspecti.length} articole din afara gestiunii MATERII PRIME, ` +
    `${cuPropunere} au un înlocuitor folosit în rețetele din SAGA.`,
)
console.log('\nScris în docs/gestiune-gresita.xlsx. Completează „COD ALES", apoi:')
console.log('  pnpm --filter @samobi/api aplica-mapari -- gestiune-gresita.xlsx')
console.log('  pnpm --filter @samobi/api incarca-fise -- --scrie --reincarca')

await clientSql.end({ timeout: 10 })
