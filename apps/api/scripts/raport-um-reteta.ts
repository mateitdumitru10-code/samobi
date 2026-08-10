import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeazaUm } from '@samobi/shared/nomenclator'
import ExcelJS from 'exceljs'

import { clientSql } from '../src/db.js'

/**
 * Where the recipe sheets and the catalogue measure the same material
 * differently.
 *
 * Checked against the names: 24 of the 26 match the catalogue exactly and the
 * other two differ only in spacing. These are not wrong mappings — the workshop
 * counts PAL in square metres and SAGA holds it per plate, glue is kilograms on
 * the sheet and containers in the catalogue. Both are right about their own
 * article.
 *
 * It does not affect the export, which carries the recipe's unit. It does affect
 * costing: a price per plate cannot be multiplied by a quantity in square
 * metres, so those lines are left out of a total rather than silently wrong.
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

/** Units that count the same thing at a different scale. */
const FACTOR: Readonly<Record<string, number>> = { BUC: 1, SUTEB: 100, MIIB: 1000 }

function verdict(umReteta: string, umSaga: string): { fel: string; nota: string } {
  const a = normalizeazaUm(umReteta) ?? umReteta
  const b = normalizeazaUm(umSaga) ?? umSaga

  if (a === b) return { fel: 'doar scriere', nota: 'aceeași unitate, scrisă altfel' }

  if (FACTOR[a] !== undefined && FACTOR[b] !== undefined) {
    return {
      fel: 'aceeași măsură',
      nota: 'bucăți numărate la altă scară — maparea e probabil bună',
    }
  }
  return {
    fel: 'PREȚ NEFOLOSIBIL',
    nota: 'unități diferite: prețul din nomenclator nu se poate înmulți cu cantitatea',
  }
}

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('UM de verificat')

foaie.addRow([
  'Cod SAGA',
  'Denumire în SAGA',
  'UM în rețetar',
  'UM în SAGA',
  'Verdict',
  'Ce înseamnă',
  'Linii',
  'Cantități în rețetar',
  'Rețete',
])
foaie.getRow(1).font = { bold: true }

let scara = 0
let scriere = 0

for (const r of randuri) {
  const g = verdict(r.um_reteta, r.um_saga)
  if (g.fel === 'aceeași măsură') scara += 1
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

const cale = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'um-de-verificat.xlsx')
writeFileSync(cale, Buffer.from(await registru.xlsx.writeBuffer()))

const [total] = await clientSql<{ c: number }[]>`
  select count(*)::int c from recipe_line where cod_saga is not null`

console.log(`${randuri.length} articole cu UM diferită de rețetar.`)
console.log(`  ${scara} aceeași măsură la altă scară — maparea e probabil bună`)
console.log(`  ${scriere} doar ca scriere`)
console.log(
  `  ${randuri.length - scara - scriere} cu preț nefolosibil — unități care nu se convertesc`,
)
console.log(`\ndin ${total?.c ?? 0} linii de rețetă cu cod SAGA.`)
console.log('Scris în docs/um-de-verificat.xlsx')

console.log('\nCu preț nefolosibil, cele mai multe linii:')
let aratate = 0
for (const r of randuri) {
  if (verdict(r.um_reteta, r.um_saga).fel !== 'PREȚ NEFOLOSIBIL' || aratate >= 12) continue
  aratate += 1
  console.log(
    `  ${r.cod_saga}  ${r.denumire.slice(0, 34).padEnd(34)} rețetar ${r.um_reteta.padEnd(7)} SAGA ${r.um_saga.padEnd(6)} ${r.nr_linii} linii`,
  )
}

await clientSql.end({ timeout: 10 })
