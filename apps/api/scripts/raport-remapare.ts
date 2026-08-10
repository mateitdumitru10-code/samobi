import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeazaUm, scorSimilaritate } from '@samobi/shared/nomenclator'
import ExcelJS from 'exceljs'

import { clientSql } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

import { toateFisele } from './fise-json.js'

/**
 * Recipe lines held in a different unit than the sheet uses, each offered the
 * articles that are in the sheet's unit and appear on bons the factory actually
 * booked.
 *
 * The unit is the symptom, not the problem. The catalogue carries a dozen
 * near-identical codes for every board and every zip, and the loader picked one
 * by name alone — often a code nobody has consumed in nineteen months. Past
 * production says which of them the workshop really uses.
 *
 * The script proposes; it writes nothing. Choosing between FERMOAR ALB and
 * FERMOAR BEJ for a sheet that says only "FERMOAR" is a decision, not a
 * deduction.
 *
 *   pnpm --filter @samobi/api raport-remapare
 *   pnpm --filter @samobi/api aplica-mapari -- remapare-propusa.xlsx
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

/** Units that count the same thing at a different scale — not a mismatch. */
const FACTOR: Readonly<Record<string, number>> = { BUC: 1, SUTEB: 100, MIIB: 1000 }

const um = (v: string | null | undefined): string => (normalizeazaUm(v ?? '') ?? '').toUpperCase()

const fisier = readdirSync(DOSAR)
  .filter((n) => n.endsWith('.xlsx'))
  .sort()
  .reverse()
  .find((n) => {
    try {
      return citesteXlsx(readFileSync(resolve(DOSAR, n))).nume === 'Productie'
    } catch {
      return false
    }
  })

if (fisier === undefined) {
  console.error('Niciun export de producție în docs/. Exportă din SAGA: Operații → Producție.')
  process.exit(1)
}

const foaie = citesteXlsx(readFileSync(resolve(DOSAR, fisier)))
const antet = foaie.randuri[0] ?? []
const c = (nume: string): number => antet.indexOf(nume)

/** Each bon's finished product, so a material can be tied to what it went into. */
const produsulBonului = new Map<string, string>()
for (const r of foaie.randuri.slice(1)) {
  const cheie = `${r[c('nr')] ?? ''}#${r[c('id_unic')] ?? ''}`
  const produs = r[c('cod')] ?? ''
  if (produs !== '' && !produsulBonului.has(cheie)) produsulBonului.set(cheie, produs)
}

const bonuriCuArticol = new Map<string, Set<string>>()
const articoleLaProdus = new Map<string, Set<string>>()

for (const r of foaie.randuri.slice(1)) {
  const material = r[c('cod1')] ?? ''
  if (material === '') continue

  const bon = r[c('nr')] ?? ''
  const set = bonuriCuArticol.get(material) ?? new Set<string>()
  set.add(bon)
  bonuriCuArticol.set(material, set)

  const produs = produsulBonului.get(`${bon}#${r[c('id_unic')] ?? ''}`)
  if (produs === undefined) continue
  const la = articoleLaProdus.get(produs) ?? new Set<string>()
  la.add(material)
  articoleLaProdus.set(produs, la)
}

const catalog = await clientSql<{ cod_saga: string; denumire: string; um: string }[]>`
  select cod_saga, denumire, um
  from saga_article
  where activ and btrim(um) <> ''`

const linii = await clientSql<
  {
    cod_saga: string
    nr_linie: number
    um_reteta: string
    um_saga: string
    denumire: string
    model: string
    produs: string | null
  }[]
>`
  select rl.cod_saga,
         rl.nr_linie,
         rl.um   as um_reteta,
         a.um    as um_saga,
         a.denumire,
         m.cod   as model,
         (select d.cod_saga_produs
            from dimension d
           where d.model_id = m.id and d.cod_saga_produs is not null
           limit 1) as produs
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where btrim(a.um) <> ''
    and upper(btrim(rl.um)) <> upper(btrim(a.um))
  order by m.cod, rl.nr_linie`

const fise = new Map(toateFisele().map((f) => [f.cod, new Map(f.linii.map((l) => [l.nr, l]))]))

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const iesire = registru.addWorksheet('Remapare')

iesire.addRow([
  'Model',
  'Poziția',
  'Material (din fișă)',
  'UM (din fișă)',
  'Cantitate',
  'COD ALES  ← scrie aici',
  'Mapat acum pe',
  'Propunere (UM din fișă + bonuri)',
  'Bonuri',
  'Alternativa 2',
  'Alternativa 3',
])
iesire.getRow(1).font = { bold: true }

let randuri = 0
let cuPropunere = 0
const faraPropunere: string[] = []

for (const l of linii) {
  const aFisa = um(l.um_reteta)
  const aSaga = um(l.um_saga)
  if (FACTOR[aFisa] !== undefined && FACTOR[aSaga] !== undefined) continue

  const dinFisa = fise.get(l.model)?.get(l.nr_linie)
  if (dinFisa === undefined) continue
  randuri += 1

  const candidati = catalog
    .filter((x) => um(x.um) === aFisa)
    .map((x) => ({
      ...x,
      scor: scorSimilaritate(dinFisa.denumire, x.denumire),
      bonuri: bonuriCuArticol.get(x.cod_saga)?.size ?? 0,
      laAcestProdus: l.produs !== null && (articoleLaProdus.get(l.produs)?.has(x.cod_saga) ?? false),
    }))
    .filter((x) => x.scor >= 0.45 && x.bonuri > 0)
    // Used at this very product first: the strongest evidence available.
    .sort(
      (x, y) =>
        Number(y.laAcestProdus) - Number(x.laAcestProdus) || y.scor - x.scor || y.bonuri - x.bonuri,
    )
    .slice(0, 3)

  if (candidati.length > 0) cuPropunere += 1
  else faraPropunere.push(`${l.model} poz. ${l.nr_linie}  ${dinFisa.denumire} (${dinFisa.um})`)

  const eticheta = (x: (typeof candidati)[number] | undefined): string =>
    x === undefined
      ? ''
      : `${x.cod_saga}  ${x.denumire} (${x.um})  nume ${Math.round(x.scor * 100)}%${
          x.laAcestProdus ? '  · folosit la acest produs' : ''
        }`

  iesire.addRow([
    l.model,
    l.nr_linie,
    dinFisa.denumire,
    dinFisa.um,
    Number(dinFisa.cantitate),
    '',
    `${l.cod_saga}  ${l.denumire} (${l.um_saga})`,
    eticheta(candidati[0]),
    candidati[0]?.bonuri ?? 0,
    eticheta(candidati[1]),
    eticheta(candidati[2]),
  ])
}

iesire.getColumn(2).numFmt = '0'
iesire.getColumn(5).numFmt = '0.0000'
iesire.getColumn(6).numFmt = '@'
iesire.getColumn(1).width = 22
iesire.getColumn(3).width = 30
iesire.getColumn(4).width = 10
iesire.getColumn(6).width = 24
for (const col of [7, 8, 10, 11]) iesire.getColumn(col).width = 52

writeFileSync(
  resolve(DOSAR, 'remapare-propusa.xlsx'),
  Buffer.from(await registru.xlsx.writeBuffer()),
)

console.log(`Istoric: ${fisier}`)
console.log(`${randuri} linii de rețetă cu unitate diferită de fișă.`)
console.log(`  ${cuPropunere} au un articol în unitatea fișei care apare pe bonuri trecute`)
console.log(`  ${randuri - cuPropunere} nu au — rămân de decis manual`)

if (faraPropunere.length > 0) {
  console.log('\nFără nicio propunere:')
  for (const r of faraPropunere.slice(0, 20)) console.log(`  ${r}`)
}

console.log('\nScris în docs/remapare-propusa.xlsx')
console.log('Completează „COD ALES", apoi:')
console.log('  pnpm --filter @samobi/api aplica-mapari -- remapare-propusa.xlsx')
console.log('  pnpm --filter @samobi/api incarca-fise -- --scrie --reincarca')

await clientSql.end({ timeout: 10 })
