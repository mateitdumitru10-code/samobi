import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import ExcelJS from 'exceljs'

import { clientSql } from '../src/db.js'

/**
 * The list of real sizes, one row per model, pre-filled with whatever can be
 * read off the data rather than typed again.
 *
 * Every model currently carries a dimension coded STANDARD whose measurements
 * were stamped by the import scripts — 2000×900×850 on every single sofa. It is
 * the same number everywhere, so it is a number about nothing, and every
 * formula calibrated against it would inherit that. This is the sheet that
 * replaces it with what the factory actually builds.
 *
 * The names of the SAGA articles do a lot of the work: „CANAPEA SORIA 1500/1900"
 * carries its own size, and where a model is linked to such an article the pair
 * is proposed. Which of the two numbers is length and which is width is the one
 * thing the catalogue does not say, and the one thing the tehnolog knows without
 * thinking.
 *
 *   pnpm --filter @samobi/api raport-dimensiuni
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

/** All the placeholder triples the import scripts stamped, by family. */
const SABLON_IMPORT = new Set([
  '2000/900/850',
  '2600/1800/850',
  '2000/1600/350',
  '600/600/450',
  // What the SAGA import writes when the report does not say: absurd on
  // purpose, so it cannot pass for a measurement.
  '1/1/',
])

interface Rand {
  model_cod: string
  model_denumire: string
  familie: string
  dimensiune_id: string
  dimensiune_cod: string
  lungime: string
  latime: string
  inaltime: string | null
  cod_saga_produs: string | null
  denumire_produs: string | null
  nr_bonuri: number
}

const randuri = await clientSql<Rand[]>`
  select m.cod                as model_cod,
         m.denumire           as model_denumire,
         m.familie,
         d.id                 as dimensiune_id,
         d.cod                as dimensiune_cod,
         d.lungime, d.latime, d.inaltime,
         d.cod_saga_produs,
         a.denumire           as denumire_produs,
         (select count(*)::int from production_order o
           where o.dimension_id = d.id and o.status <> 'anulat') as nr_bonuri
  from model m
  join dimension d on d.model_id = m.id
  left join saga_article a on a.cod_saga = d.cod_saga_produs
  where m.activ and d.activ
  order by m.cod, d.cod`

/**
 * The size hiding in an article name: „CANAPEA SORIA 1500/1900 R" → 1500, 1900.
 *
 * Only pairs and triples of plausible millimetre values are taken. „SORIA 2.65"
 * and „SORIA 3L" are sizes too, in metres and in seats, but guessing which is
 * which is exactly the sort of help that costs more than it saves.
 */
function dinDenumire(denumire: string | null): number[] {
  if (denumire === null) return []
  const numere = [...denumire.matchAll(/\b(\d{3,4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 300 && n <= 5000)
  return numere.length >= 2 && numere.length <= 3 ? numere : []
}

/**
 * The size in a model's own code: `PAT-DAVID-2000X1400`.
 *
 * Worth more than the same numbers read off an article name — this one was
 * transcribed from the title of the sheet, so it is the size the sheet's
 * quantities were written for, which is exactly the question being asked.
 */
function dinCodModel(cod: string): number[] {
  const potrivire = /(\d{3,4})\s*[X×x]\s*(\d{3,4})/.exec(cod)
  if (potrivire === null) return []
  return [Number(potrivire[1]), Number(potrivire[2])]
}

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('Dimensiuni reale')

foaie.addRow([
  'Model',
  'Denumire',
  'Familie',
  'Dimensiune',
  'Lungime acum',
  'Latime acum',
  'Inaltime acum',
  'Din import?',
  'Lungime REALA  ←',
  'Latime REALA  ←',
  'Inaltime REALA  ←',
  'Produs finit în SAGA',
  'Bonuri',
])
foaie.getRow(1).font = { bold: true }

let dePus = 0
let sabloane = 0

for (const r of randuri) {
  const cheie = `${Number(r.lungime)}/${Number(r.latime)}/${r.inaltime === null ? '' : Number(r.inaltime)}`
  const dinImport = SABLON_IMPORT.has(cheie)
  if (dinImport) sabloane += 1

  // The sheet's own title first: it is the only source that is about this
  // recipe rather than about some article in the catalogue.
  const dinCod = dinCodModel(r.model_cod)
  const propuse = dinCod.length >= 2 ? dinCod : dinDenumire(r.denumire_produs)
  if (propuse.length >= 2) dePus += 1

  foaie.addRow([
    r.model_cod,
    r.model_denumire,
    r.familie,
    r.dimensiune_cod,
    Number(r.lungime),
    Number(r.latime),
    r.inaltime === null ? '' : Number(r.inaltime),
    dinImport ? 'DA — valoare de umplutură' : '',
    propuse[0] ?? '',
    propuse[1] ?? '',
    propuse[2] ?? '',
    r.cod_saga_produs === null
      ? '— nelegat —'
      : `${r.cod_saga_produs}  ${r.denumire_produs ?? ''}`,
    r.nr_bonuri,
  ])
}

for (const col of [5, 6, 7, 9, 10, 11]) {
  foaie.getColumn(col).numFmt = '0'
  foaie.getColumn(col).width = 9
}
foaie.getColumn(1).width = 26
foaie.getColumn(2).width = 30
foaie.getColumn(4).width = 14
foaie.getColumn(8).width = 24
foaie.getColumn(12).width = 46

writeFileSync(resolve(DOSAR, 'dimensiuni-reale.xlsx'), Buffer.from(await registru.xlsx.writeBuffer()))

console.log(`${randuri.length} dimensiuni pe ${new Set(randuri.map((r) => r.model_cod)).size} modele.`)
console.log(`  ${sabloane} au măsuri puse de scriptul de import — nu descriu nimic real`)
console.log(`  ${dePus} au o propunere citită din denumirea articolului SAGA`)
console.log('\nScris în docs/dimensiuni-reale.xlsx.')
console.log('Completează „Lungime/Latime/Inaltime REALA" — propunerile sunt un punct de plecare,')
console.log('și nici catalogul nu știe care număr e lungimea. Apoi:')
console.log('  pnpm --filter @samobi/api aplica-dimensiuni -- --scrie')

await clientSql.end({ timeout: 10 })
