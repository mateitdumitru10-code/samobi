import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeazaUm } from '@samobi/shared/nomenclator'
import ExcelJS from 'exceljs'

import { clientSql } from '../src/db.js'

/**
 * Where the recipe sheets and SAGA disagree about a unit of measure.
 *
 * The sheets are the source of truth, so this is a list of articles to correct
 * in SAGA — not a list of recipes to change.
 *
 * It matters more than a spelling difference. CAPSE 380/14 is 1,1 MIIB on the
 * sheet, meaning 1.100 staples, while SAGA holds the article in BUC. Sent as
 * written, SAGA books 1,1 pieces. The error is a factor of a thousand and
 * nothing in the file looks wrong.
 *
 *   pnpm --filter @samobi/api raport-um-reteta
 */

interface Rand {
  cod_saga: string
  denumire: string
  um_reteta: string
  um_saga: string
  retete: string
  nr_linii: number
  cantitate_min: string
  cantitate_max: string
}

const randuri = await clientSql<Rand[]>`
  select rl.cod_saga,
         min(a.denumire)                                   as denumire,
         rl.um                                             as um_reteta,
         min(a.um)                                         as um_saga,
         string_agg(distinct m.cod, ', ' order by m.cod)   as retete,
         count(*)::int                                     as nr_linii,
         min(coalesce(rl.cantitate_fixa, 0))::text         as cantitate_min,
         max(coalesce(rl.cantitate_fixa, 0))::text         as cantitate_max
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where btrim(a.um) <> ''
    and upper(btrim(rl.um)) <> upper(btrim(a.um))
  group by rl.cod_saga, rl.um
  order by count(*) desc, min(a.denumire)`

/**
 * Units that differ by a factor rather than in kind.
 *
 * These are the dangerous ones: the quantity is right and the unit is wrong, so
 * the booking is off by exactly a thousand or a hundred and looks plausible.
 */
const FACTOR: Readonly<Record<string, number>> = { BUC: 1, SUTEB: 100, MIIB: 1000 }

function gravitate(umReteta: string, umSaga: string): { fel: string; nota: string } {
  const a = normalizeazaUm(umReteta) ?? umReteta
  const b = normalizeazaUm(umSaga) ?? umSaga

  if (a === b) return { fel: 'doar scriere', nota: 'aceeași unitate, scrisă altfel' }

  const fa = FACTOR[a]
  const fb = FACTOR[b]
  if (fa !== undefined && fb !== undefined) {
    const raport = fa / fb
    return {
      fel: 'FACTOR',
      nota: `cantitatea ar fi de ${raport > 1 ? raport : 1 / raport}× ${raport > 1 ? 'mai mică' : 'mai mare'} în SAGA`,
    }
  }
  return { fel: 'unități diferite', nota: 'nu se convertesc una în alta — verifică maparea' }
}

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('UM de corectat')

foaie.addRow([
  'Cod SAGA',
  'Denumire în SAGA',
  'UM în rețetar',
  'UM în SAGA',
  'Gravitate',
  'Ce se întâmplă la import',
  'Linii',
  'Cantități în rețetar',
  'Rețete',
])
foaie.getRow(1).font = { bold: true }

let factor = 0
let scriere = 0

for (const r of randuri) {
  const g = gravitate(r.um_reteta, r.um_saga)
  if (g.fel === 'FACTOR') factor += 1
  if (g.fel === 'doar scriere') scriere += 1

  const min = Number(r.cantitate_min)
  const max = Number(r.cantitate_max)

  foaie.addRow([
    r.cod_saga,
    r.denumire,
    r.um_reteta,
    r.um_saga,
    g.fel,
    g.nota,
    r.nr_linii,
    min === max ? String(min) : `${min} – ${max}`,
    r.retete,
  ])
}

foaie.getColumn(1).numFmt = '@'
foaie.getColumn(1).width = 12
foaie.getColumn(2).width = 40
foaie.getColumn(3).width = 14
foaie.getColumn(4).width = 12
foaie.getColumn(5).width = 16
foaie.getColumn(6).width = 44
foaie.getColumn(7).width = 8
foaie.getColumn(8).width = 20
foaie.getColumn(9).width = 60

const cale = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'um-de-corectat-in-saga.xlsx')
writeFileSync(cale, Buffer.from(await registru.xlsx.writeBuffer()))

const [total] = await clientSql<{ c: number }[]>`
  select count(*)::int c from recipe_line where cod_saga is not null`

console.log(`${randuri.length} articole cu UM diferită de rețetar.`)
console.log(`  ${factor} periculoase — diferă printr-un factor de 100 sau 1000`)
console.log(`  ${scriere} doar ca scriere, aceeași unitate`)
console.log(`  ${randuri.length - factor - scriere} unități care nu se convertesc — verifică maparea`)
console.log(`\ndin ${total?.c ?? 0} linii de rețetă cu cod SAGA.`)
console.log('Scris în docs/um-de-corectat-in-saga.xlsx')

console.log('\nCele mai periculoase:')
for (const r of randuri.slice(0, 12)) {
  const g = gravitate(r.um_reteta, r.um_saga)
  if (g.fel !== 'FACTOR') continue
  console.log(
    `  ${r.cod_saga}  ${r.denumire.slice(0, 32).padEnd(32)} rețetar ${r.um_reteta.padEnd(7)} SAGA ${r.um_saga.padEnd(6)} ${g.nota}`,
  )
}

await clientSql.end({ timeout: 10 })
