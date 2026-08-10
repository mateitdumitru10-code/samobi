import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { evalueazaFormula, valideazaFormula, type EroareCalcul } from '@samobi/shared/calcul'
import { and, eq, sql } from 'drizzle-orm'
import { recipe, recipeLine } from '@samobi/shared/db'

import { clientSql, db } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

/**
 * Writes the chosen formulas into the draft recipe.
 *
 * Before writing, every formula is made to prove itself twice: it parses, and
 * it reproduces the quantity the sheet already says is right at the size it was
 * calibrated on. The second check is the whole point — it is what turns the
 * master's number from something replaced by a formula into something the
 * formula has to agree with.
 *
 *   pnpm --filter @samobi/api aplica-formule -- C3-SORIA 1900 1000 850
 *   pnpm --filter @samobi/api aplica-formule -- C3-SORIA 1900 1000 850 --scrie
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

const argumente = process.argv.slice(2).filter((a) => a !== '--')
const scrie = argumente.includes('--scrie')
const [codModel, lungime, latime, inaltime] = argumente.filter((a) => !a.startsWith('--'))

if (codModel === undefined || lungime === undefined || latime === undefined) {
  console.error('Folosire: aplica-formule -- <COD-MODEL> <L> <l> [H] [--scrie]')
  process.exit(1)
}

const scop = {
  L: Number(lungime),
  l: Number(latime),
  H: inaltime === undefined ? null : Number(inaltime),
}

const foaie = citesteXlsx(readFileSync(resolve(DOSAR, 'formule-propuse.xlsx')))
const antet = foaie.randuri[0] ?? []

const coloana = (nume: string): number => {
  const index = antet.findIndex((c) => c.toLowerCase().startsWith(nume.toLowerCase()))
  if (index < 0) throw new Error(`Lipsește coloana „${nume}" din fișier.`)
  return index
}

const cLinia = coloana('Linia')
const cCantitate = coloana('Cantitate')
const cFormula = coloana('FORMULA ALEASĂ')

interface Alegere {
  nrLinie: number
  cantitate: number
  formula: string
}

const alegeri: Alegere[] = []

for (let i = 1; i < foaie.randuri.length; i += 1) {
  const rand = foaie.randuri[i] ?? []
  const formula = (rand[cFormula] ?? '').trim()
  if (formula === '') continue

  const nrLinie = Number.parseInt(rand[cLinia] ?? '', 10)
  if (Number.isNaN(nrLinie)) continue

  alegeri.push({
    nrLinie,
    cantitate: Number(rand[cCantitate] ?? ''),
    // Tolerates a pasted "suprafață:  L*l/1000000 * 2.017".
    formula: formula.includes(':') ? (formula.split(':').slice(1).join(':').trim() ?? formula) : formula,
  })
}

if (alegeri.length === 0) {
  console.log('Nicio formulă completată în coloana „FORMULA ALEASĂ". Nu am ce aplica.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

/** Within a thousandth: finer than the sheets are written, so a real mismatch shows. */
const TOLERANTA = 0.001

const bune: Alegere[] = []
let rele = 0

console.log(`${codModel}, verificare la ${scop.L}×${scop.l}${scop.H === null ? '' : `×${scop.H}`} mm\n`)

for (const alegere of alegeri) {
  try {
    valideazaFormula(alegere.formula, alegere.nrLinie)
  } catch (err) {
    console.log(`  linia ${alegere.nrLinie}  RESPINSĂ  ${(err as EroareCalcul).message}`)
    rele += 1
    continue
  }

  const rezultat = evalueazaFormula(alegere.formula, scop)
  const valoare = Number(rezultat.valoare.toString())

  if (!rezultat.esteNumar) {
    console.log(`  linia ${alegere.nrLinie}  RESPINSĂ  nu produce un număr: ${rezultat.expresieEvaluata}`)
    rele += 1
    continue
  }

  const abatere = Math.abs(valoare - alegere.cantitate)
  if (abatere > TOLERANTA) {
    console.log(
      `  linia ${alegere.nrLinie}  RESPINSĂ  dă ${valoare} în loc de ${alegere.cantitate} ` +
        `(diferență ${abatere.toFixed(4)})`,
    )
    rele += 1
    continue
  }

  console.log(
    `  linia ${String(alegere.nrLinie).padStart(3)}  ${alegere.formula.padEnd(46)} = ${valoare}  ✓`,
  )
  bune.push(alegere)
}

console.log(`\n${bune.length} formule reproduc fișa, ${rele} respinse.`)

if (rele > 0) {
  console.error('\nNu scriu nimic cât timp există formule respinse — corectează-le în fișier.')
  await clientSql.end({ timeout: 5 })
  process.exit(1)
}

if (!scrie) {
  console.log('\nNimic scris. Rulează din nou cu --scrie ca să le pună în rețetă.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

const [draft] = await clientSql<{ id: string; versiune: number }[]>`
  select r.id, r.versiune from recipe r join model m on m.id = r.model_id
  where m.cod = ${codModel} and r.status = 'draft'
  order by r.versiune desc limit 1`

if (draft === undefined) {
  console.error(`${codModel} nu are o rețetă în lucru. Formulele se scriu doar într-un draft.`)
  await clientSql.end({ timeout: 5 })
  process.exit(1)
}

await db.transaction(async (tx) => {
  for (const alegere of bune) {
    await tx
      .update(recipeLine)
      .set({ modCalcul: 'formula', formula: alegere.formula, cantitateFixa: null })
      .where(and(eq(recipeLine.recipeId, draft.id), eq(recipeLine.nrLinie, alegere.nrLinie)))
  }
  await tx
    .update(recipe)
    .set({ lockVersion: sql`${recipe.lockVersion} + 1` })
    .where(eq(recipe.id, draft.id))
})

console.log(`\nScrise în ${codModel} v${draft.versiune}: ${bune.length} linii trecute pe formulă.`)
console.log('Deschide „Modele și rețete" și declară intervalul la comandă — verificarea')
console.log('pe colțuri îți spune dacă formulele țin și la capetele lui.')

await clientSql.end({ timeout: 10 })
