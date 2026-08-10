import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { dimension } from '@samobi/shared/db'
import { eq } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

/**
 * Writes the real measurements back onto the dimensions.
 *
 * Refuses any row that already has a bon behind it, for the same reason the API
 * does: the consumption on that bon was computed from these numbers, and
 * changing them afterwards rewrites what a document already sent to accounting
 * means. Those get a new dimension instead, by hand.
 *
 *   pnpm --filter @samobi/api aplica-dimensiuni
 *   pnpm --filter @samobi/api aplica-dimensiuni -- --scrie
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')
const scrie = process.argv.slice(2).includes('--scrie')

const foaie = citesteXlsx(readFileSync(resolve(DOSAR, 'dimensiuni-reale.xlsx')))
const antet = foaie.randuri[0] ?? []

const coloana = (nume: string): number => {
  const index = antet.findIndex((c) => c.toLowerCase().startsWith(nume.toLowerCase()))
  if (index < 0) throw new Error(`Lipsește coloana „${nume}" din fișier.`)
  return index
}

const cModel = coloana('Model')
const cDimensiune = coloana('Dimensiune')
// Distinct words on purpose: the lookup is case-insensitive, so headers that
// differ only by „L" versus „l" resolve to the same column and the width comes
// out equal to the length.
const cL = coloana('Lungime REALA')
const cl = coloana('Latime REALA')
const cH = coloana('Inaltime REALA')

const intreg = (v: string | undefined): number | null => {
  const text = (v ?? '').trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : Number.NaN
}

interface Alegere {
  model: string
  cod: string
  lungime: number
  latime: number
  inaltime: number | null
}

const alegeri: Alegere[] = []
let invalide = 0

for (let i = 1; i < foaie.randuri.length; i += 1) {
  const rand = foaie.randuri[i] ?? []
  const L = intreg(rand[cL])
  const l = intreg(rand[cl])
  const H = intreg(rand[cH])

  if (L === null && l === null) continue

  if (L === null || l === null || Number.isNaN(L) || Number.isNaN(l) || Number.isNaN(H)) {
    console.error(
      `  ${rand[cModel] ?? ''} / ${rand[cDimensiune] ?? ''}: L și l sunt obligatorii, ` +
        'milimetri întregi.',
    )
    invalide += 1
    continue
  }

  alegeri.push({
    model: (rand[cModel] ?? '').trim(),
    cod: (rand[cDimensiune] ?? '').trim(),
    lungime: L,
    latime: l,
    inaltime: H,
  })
}

if (invalide > 0) {
  console.error(`\n${invalide} rânduri invalide. Nu scriu nimic până nu sunt corectate.`)
  await clientSql.end({ timeout: 5 })
  process.exit(1)
}

if (alegeri.length === 0) {
  console.log('Nicio dimensiune completată. Nu am ce aplica.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

const existente = await clientSql<
  {
    id: string
    model_cod: string
    cod: string
    lungime: string
    latime: string
    inaltime: string | null
    nr_bonuri: number
  }[]
>`
  select d.id, m.cod as model_cod, d.cod, d.lungime, d.latime, d.inaltime,
         (select count(*)::int from production_order o
           where o.dimension_id = d.id and o.status <> 'anulat') as nr_bonuri
  from dimension d join model m on m.id = d.model_id`

const dupaCheie = new Map(existente.map((d) => [`${d.model_cod}#${d.cod}`, d]))

const deScris: { id: string; alegere: Alegere }[] = []
const blocate: string[] = []
let neschimbate = 0

for (const a of alegeri) {
  const gasita = dupaCheie.get(`${a.model}#${a.cod}`)
  if (gasita === undefined) {
    console.error(`  ${a.model} / ${a.cod}: nu există în bază.`)
    invalide += 1
    continue
  }

  const laFel =
    Number(gasita.lungime) === a.lungime &&
    Number(gasita.latime) === a.latime &&
    (gasita.inaltime === null ? a.inaltime === null : Number(gasita.inaltime) === a.inaltime)
  if (laFel) {
    neschimbate += 1
    continue
  }

  if (gasita.nr_bonuri > 0) {
    blocate.push(
      `${a.model} / ${a.cod}: ${gasita.nr_bonuri} bonuri emise pe măsurile vechi — ` +
        'adaugă o dimensiune nouă, nu o rescrie pe asta.',
    )
    continue
  }

  console.log(
    `  ${a.model.padEnd(28)} ${a.cod.padEnd(12)} ` +
      `${Number(gasita.lungime)}×${Number(gasita.latime)}` +
      `${gasita.inaltime === null ? '' : `×${Number(gasita.inaltime)}`}` +
      `  →  ${a.lungime}×${a.latime}${a.inaltime === null ? '' : `×${a.inaltime}`}`,
  )
  deScris.push({ id: gasita.id, alegere: a })
}

console.log(`\n${deScris.length} de modificat, ${neschimbate} deja corecte, ${blocate.length} blocate.`)
for (const b of blocate) console.error(`  ${b}`)

if (invalide > 0) {
  console.error('\nNu scriu nimic cât timp există rânduri invalide.')
  await clientSql.end({ timeout: 5 })
  process.exit(1)
}

if (!scrie) {
  console.log('\nNimic scris. Rulează din nou cu --scrie.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

await db.transaction(async (tx) => {
  for (const { id, alegere } of deScris) {
    await tx
      .update(dimension)
      .set({
        lungime: String(alegere.lungime),
        latime: String(alegere.latime),
        inaltime: alegere.inaltime === null ? null : String(alegere.inaltime),
      })
      .where(eq(dimension.id, id))
  }
})

console.log(`\n${deScris.length} dimensiuni actualizate.`)
console.log('Acum formulele se pot calibra pe măsuri reale:')
console.log('  pnpm --filter @samobi/api propune-formule -- <COD-MODEL> <L> <l> <H>')

await clientSql.end({ timeout: 10 })
