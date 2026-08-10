import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sagaArticle } from '@samobi/shared/db'
import { scorSimilaritate, sugereaza, type Candidat } from '@samobi/shared/nomenclator'
import { eq } from 'drizzle-orm'
import ExcelJS from 'exceljs'

import { clientSql, db } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

import { FISE } from './fise.js'

/**
 * What SAGA already knows, from the production export: for a finished product,
 * exactly which articles were discharged against it and in what quantity.
 *
 * This narrows the candidates from 24.000 to the couple of hundred a product
 * genuinely consumes, and adds two things a name cannot give — how often an
 * article appears across bons, and how much of it goes into one unit.
 */
interface Consum {
  denumire: string
  um: string
  bonuri: Set<string>
  perUnitate: number[]
}

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

/** The production export names its sheet `Productie`; that is how it is found. */
function gasesteIstoric(): string | null {
  for (const nume of readdirSync(DOSAR).filter((n) => n.endsWith('.xlsx')).sort().reverse()) {
    try {
      if (citesteXlsx(readFileSync(resolve(DOSAR, nume))).nume === 'Productie') return nume
    } catch {
      continue
    }
  }
  return null
}

const istoric = new Map<string, Map<string, Consum>>()
const bonuriPerProdus = new Map<string, number>()

const numeIstoric = gasesteIstoric()
if (numeIstoric !== null) {
  const foaie = citesteXlsx(readFileSync(resolve(DOSAR, numeIstoric)))
  const antet = foaie.randuri[0] ?? []
  const c = (nume: string) => antet.indexOf(nume)
  const [iNr, iId, iProd, iCant, iMat, iDenMat, iUmMat, iCantMat] = [
    c('nr'), c('id_unic'), c('cod'), c('cantitate'), c('cod1'), c('denumire1'), c('um1'), c('cantitate1'),
  ]

  const cantitateBon = new Map<string, { produs: string; cant: number }>()
  for (const r of foaie.randuri.slice(1)) {
    const cheie = `${r[iNr] ?? ''}#${r[iId] ?? ''}`
    if ((r[iProd] ?? '') === '' || cantitateBon.has(cheie)) continue
    cantitateBon.set(cheie, { produs: r[iProd] ?? '', cant: Number(r[iCant]) || 1 })
  }
  for (const v of cantitateBon.values()) {
    bonuriPerProdus.set(v.produs, (bonuriPerProdus.get(v.produs) ?? 0) + 1)
  }

  for (const r of foaie.randuri.slice(1)) {
    const produs = r[iProd] ?? ''
    const material = r[iMat] ?? ''
    if (produs === '' || material === '') continue
    const bon = cantitateBon.get(`${r[iNr] ?? ''}#${r[iId] ?? ''}`)
    if (bon === undefined) continue

    const perProdus = istoric.get(produs) ?? new Map<string, Consum>()
    const consum = perProdus.get(material) ?? {
      denumire: r[iDenMat] ?? '',
      um: r[iUmMat] ?? '',
      bonuri: new Set<string>(),
      perUnitate: [],
    }
    consum.bonuri.add(`${r[iNr] ?? ''}#${r[iId] ?? ''}`)
    consum.perUnitate.push((Number(r[iCantMat]) || 0) / (bon.cant || 1))
    perProdus.set(material, consum)
    istoric.set(produs, perProdus)
  }
  console.log(`Istoric de producție: ${numeIstoric}, ${istoric.size} produse.`)
} else {
  console.log('Fără export de producție în docs/ — candidații vin doar din denumire.')
}

function mediana(valori: readonly number[]): number {
  const sortate = [...valori].sort((a, b) => a - b)
  return sortate[Math.floor(sortate.length / 2)] ?? 0
}

interface Propunere {
  cod: string
  denumire: string
  um: string
  frecventa: number
  medie: number
  nume: number
  /** Name and quantity agree — the only combination worth trusting. */
  tare: boolean
}

function dinIstoric(codProdus: string | null, denumire: string, cantitate: number): Propunere[] {
  if (codProdus === null) return []
  const consumuri = istoric.get(codProdus)
  const nrBonuri = bonuriPerProdus.get(codProdus) ?? 0
  if (consumuri === undefined || nrBonuri === 0) return []

  return [...consumuri]
    .map(([cod, c]) => {
      const medie = mediana(c.perUnitate)
      const abatere = cantitate > 0 ? Math.abs(medie - cantitate) / cantitate : 1
      const nume = scorSimilaritate(denumire, c.denumire)
      return {
        cod,
        denumire: c.denumire,
        um: c.um,
        frecventa: c.bonuri.size / nrBonuri,
        medie,
        nume,
        // Quantity alone collides constantly — half the recipe is "2" of
        // something. Only together with the name does it decide anything.
        tare: nume >= 0.5 && abatere <= 0.05 && c.bonuri.size / nrBonuri >= 0.25,
      }
    })
    .filter((p) => p.nume >= 0.35)
    .sort((a, b) => Number(b.tare) - Number(a.tare) || b.nume - a.nume)
    .slice(0, 3)
}

/**
 * Writes the worksheet a tehnolog fills in to finish the recipes.
 *
 * Every line of every transcribed sheet that the matcher would not accept on its
 * own, with the unit from the sheet and the three closest catalogue articles. One
 * column is left empty: the code the human chooses. Nothing here decides
 * anything — deciding is the point of the sheet.
 *
 *   pnpm --filter @samobi/api raport-nemapate
 */

const toate = await db
  .select({
    codSaga: sagaArticle.codSaga,
    denumire: sagaArticle.denumire,
    um: sagaArticle.um,
    tip: sagaArticle.tip,
  })
  .from(sagaArticle)
  .where(eq(sagaArticle.activ, true))

const materiiPrime: Candidat[] = toate
  .filter((a) => a.tip === 'materie_prima')
  .map((a) => ({ codSaga: a.codSaga, denumire: a.denumire }))

const umDupaCod = new Map(toate.map((a) => [a.codSaga, a.um]))

const liniiInReteta = await clientSql<{ recipe_cod: string; pozitie: string }[]>`
  select m.cod as recipe_cod,
         substring(rl.observatii from 'poziția ([0-9]+)') as pozitie
  from recipe_line rl
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where rl.observatii is not null`

const acoperite = new Set(liniiInReteta.map((r) => `${r.recipe_cod}#${r.pozitie}`))

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('De mapat')

foaie.addRow([
  'Model',
  'Poziția în fișă',
  'Material (din fișă)',
  'UM (din fișă)',
  'Cantitate',
  'COD ALES  ← completează aici',
  'Din istoricul de producție 1',
  'Cât de des',
  'Cantitate/buc',
  'Din istoricul de producție 2',
  'Din istoricul de producție 3',
  'Doar după denumire 1',
  'Doar după denumire 2',
])
foaie.getRow(1).font = { bold: true }

/** The SAGA product each model is booked as, so its own history can be read. */
const produsPerModel = new Map(
  (
    await clientSql<{ cod: string; cod_saga_produs: string | null }[]>`
      select m.cod, d.cod_saga_produs
      from model m join dimension d on d.model_id = m.id`
  ).map((r) => [r.cod, r.cod_saga_produs]),
)

let total = 0
let tari = 0

for (const fisa of FISE) {
  const codProdus = produsPerModel.get(fisa.cod) ?? null
  for (const linie of fisa.linii) {
    if (linie.variabil === true) continue
    if (acoperite.has(`${fisa.cod}#${linie.nr}`)) continue

    total += 1
    const dinProductie = dinIstoric(codProdus, linie.denumire, Number(linie.cantitate))
    if (dinProductie[0]?.tare === true) tari += 1

    const sugestii = sugereaza(linie.denumire, materiiPrime, { limita: 2, prag: 0.25 })
    const eticheta = (p: Propunere | undefined) =>
      p === undefined ? '' : `${p.tare ? '✓ ' : ''}${p.cod}  ${p.denumire} (${p.um})`

    foaie.addRow([
      fisa.cod,
      linie.nr,
      linie.denumire,
      linie.um,
      Number(linie.cantitate),
      // Pre-filled only where the name and the quantity agree; a proposal, still
      // to be looked at, never a decision made on the reader's behalf.
      dinProductie[0]?.tare === true ? dinProductie[0].cod : '',
      eticheta(dinProductie[0]),
      dinProductie[0] === undefined ? '' : `${Math.round(dinProductie[0].frecventa * 100)}%`,
      dinProductie[0] === undefined ? '' : Number(dinProductie[0].medie.toFixed(4)),
      eticheta(dinProductie[1]),
      eticheta(dinProductie[2]),
      sugestii[0] === undefined
        ? ''
        : `${sugestii[0].codSaga}  ${sugestii[0].denumire} (${umDupaCod.get(sugestii[0].codSaga) ?? '?'}) ${Math.round(sugestii[0].scor * 100)}%`,
      sugestii[1] === undefined
        ? ''
        : `${sugestii[1].codSaga}  ${sugestii[1].denumire} (${umDupaCod.get(sugestii[1].codSaga) ?? '?'}) ${Math.round(sugestii[1].scor * 100)}%`,
    ])
  }
}

foaie.getColumn(2).numFmt = '0'
foaie.getColumn(5).numFmt = '0.0000'
foaie.getColumn(6).numFmt = '@'
foaie.getColumn(9).numFmt = '0.0000'
foaie.getColumn(1).width = 20
foaie.getColumn(2).width = 14
foaie.getColumn(3).width = 30
foaie.getColumn(4).width = 10
foaie.getColumn(5).width = 12
foaie.getColumn(6).width = 26
for (const c of [7, 10, 11, 12, 13]) foaie.getColumn(c).width = 46
foaie.getColumn(8).width = 11
foaie.getColumn(9).width = 14

const cale = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'materiale-de-mapat.xlsx')
writeFileSync(cale, Buffer.from(await registru.xlsx.writeBuffer()))

console.log(`${total} linii de mapat, din ${FISE.length} rețete.`)
console.log(
  `${tari} au denumirea ȘI cantitatea în acord cu istoricul — precompletate, dar tot de verificat.`,
)
for (const fisa of FISE) {
  const lipsa = fisa.linii.filter(
    (l) => l.variabil !== true && !acoperite.has(`${fisa.cod}#${l.nr}`),
  )
  console.log(
    `  ${fisa.cod.padEnd(20)} ${String(fisa.linii.length).padStart(3)} în fișă, ` +
      `${String(fisa.linii.length - lipsa.length).padStart(3)} în rețetă, ${lipsa.length} de mapat`,
  )
}
console.log('\nScris în docs/materiale-de-mapat.xlsx')
console.log('Completează coloana „COD ALES" și rulează: pnpm --filter @samobi/api aplica-mapari')

await clientSql.end({ timeout: 10 })
