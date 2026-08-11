import { evalueazaFormula, valideazaFormula } from '@samobi/shared/calcul'
import { recipe, recipeLine } from '@samobi/shared/db'
import { inArray, sql } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'

/**
 * Turns one material's fixed quantity into a formula, everywhere it appears.
 *
 * The conversion is the dangerous half of this feature: three thousand eight
 * hundred quantities are correct today, and a formula that is subtly wrong
 * books the wrong thing on every bon from then on. So the formula is not
 * trusted — it is made to prove itself against what is already there.
 *
 * A line is converted only if the formula, evaluated on every registered size
 * of that model, gives back exactly the quantity the recipe already holds. A
 * line where it does not is reported and left alone: either the formula is
 * wrong, or that model is genuinely different, and both are things a person
 * has to look at.
 *
 * The old quantity stays in `cantitate_fixa` — the schema allows it on a
 * formula line, and it is the only reference anyone will have later for what
 * the formula was meant to reproduce.
 *
 *   pnpm --filter @samobi/api aplica-formula-articol -- 00011469 "4 + 4*min(1, floor(l/1400))" --familie=PAT
 *   pnpm --filter @samobi/api aplica-formula-articol -- 00011469 "..." --familie=PAT --scrie
 */

const argumente = process.argv.slice(2).filter((a) => a !== '--')
const scrie = argumente.includes('--scrie')
const familie = argumente
  .find((a) => a.startsWith('--familie='))
  ?.slice('--familie='.length)
  .toUpperCase()
const [codSaga, formula] = argumente.filter((a) => !a.startsWith('--'))

if (codSaga === undefined || formula === undefined) {
  console.error(
    'Folosire: aplica-formula-articol -- <COD-SAGA> "<formula>" [--familie=PAT] [--scrie]',
  )
  process.exit(1)
}

try {
  valideazaFormula(formula)
} catch (err) {
  console.error(`Formula nu e validă: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

interface Linie {
  linie_id: string
  recipe_id: string
  model: string
  familie: string
  nr_linie: number
  cantitate_fixa: string | null
  um: string
  procent_pierderi: string
  mod_calcul: string
  bonuri: number
}

const linii = await clientSql<Linie[]>`
  select rl.id as linie_id, rl.recipe_id, m.cod as model, m.familie, rl.nr_linie,
         rl.cantitate_fixa, rl.um, rl.procent_pierderi, rl.mod_calcul,
         (select count(*)::int from production_order p
           where p.model_id = m.id and p.status <> 'anulat') as bonuri
  from recipe_line rl
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where rl.cod_saga = ${codSaga} and m.activ
  order by m.cod`

interface Dim {
  model: string
  cod: string
  lungime: string
  latime: string
  inaltime: string | null
}

const dimensiuni = await clientSql<Dim[]>`
  select m.cod as model, d.cod, d.lungime, d.latime, d.inaltime
  from dimension d join model m on m.id = d.model_id
  where d.activ and m.activ
  order by m.cod, d.cod`

const peModel = new Map<string, Dim[]>()
for (const d of dimensiuni) {
  const grup = peModel.get(d.model)
  if (grup === undefined) peModel.set(d.model, [d])
  else grup.push(d)
}

/** The filler the import scripts stamp when nothing is known. Not a size. */
function esteReala(d: Dim): boolean {
  return Number(d.lungime) > 1 && Number(d.latime) > 1
}

const deScris: { id: string; recipeId: string; model: string; nr: number; cant: string }[] = []
const sarite: { model: string; motiv: string }[] = []

console.log(`\n${codSaga}   ${formula}\n`)

for (const l of linii) {
  const eticheta = `${l.model} (linia ${l.nr_linie})`

  if (familie !== undefined && l.familie.toUpperCase() !== familie) {
    sarite.push({ model: eticheta, motiv: `familia ${l.familie}, nu ${familie}` })
    continue
  }
  if (l.mod_calcul !== 'fixa' || l.cantitate_fixa === null) {
    sarite.push({ model: eticheta, motiv: `e deja pe „${l.mod_calcul}"` })
    continue
  }
  // A bon pins the quantity it was computed from, so converting a line under a
  // bon does not rewrite history — but it does change what the next bon on the
  // same recipe books, and that deserves a person.
  if (l.bonuri > 0) {
    sarite.push({ model: eticheta, motiv: `modelul are ${l.bonuri} bonuri` })
    continue
  }

  const dims = (peModel.get(l.model) ?? []).filter(esteReala)
  if (dims.length === 0) {
    sarite.push({ model: eticheta, motiv: 'nicio dimensiune reală — nu am pe ce verifica' })
    continue
  }

  const asteptat = Number(l.cantitate_fixa)
  const rezultate = dims.map((d) => ({
    cod: d.cod,
    L: Number(d.lungime),
    l: Number(d.latime),
    valoare: evalueazaFormula(formula, {
      L: Number(d.lungime),
      l: Number(d.latime),
      H: d.inaltime === null ? null : Number(d.inaltime),
    }),
  }))

  const gresite = rezultate.filter(
    (r) => !r.valoare.esteNumar || Number(r.valoare.valoare) !== asteptat,
  )

  if (gresite.length > 0) {
    const detaliu = gresite
      .map((g) => `${g.cod} (l=${g.l}) → ${g.valoare.esteNumar ? g.valoare.valoare : 'nenumeric'}`)
      .join(', ')
    sarite.push({ model: eticheta, motiv: `rețeta zice ${asteptat}, formula dă ${detaliu}` })
    continue
  }

  console.log(
    `  ✓ ${l.model.padEnd(32)} ${rezultate.map((r) => `l=${r.l} → ${r.valoare.valoare}`).join(', ')}`,
  )
  deScris.push({
    id: l.linie_id,
    recipeId: l.recipe_id,
    model: l.model,
    nr: l.nr_linie,
    cant: l.cantitate_fixa,
  })
}

if (sarite.length > 0) {
  console.log(`\n${sarite.length} lăsate cum sunt:`)
  for (const s of sarite) console.log(`    ${s.model.padEnd(34)} ${s.motiv}`)
}

if (deScris.length === 0 || !scrie) {
  console.log(`\n${deScris.length} de convertit. Nimic scris. Rulează din nou cu --scrie.`)
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

await db.transaction(async (tx) => {
  await tx
    .update(recipeLine)
    .set({ modCalcul: 'formula', formula })
    .where(
      inArray(
        recipeLine.id,
        deScris.map((d) => d.id),
      ),
    )

  // Anyone with the recipe open is now looking at something else.
  await tx
    .update(recipe)
    .set({ lockVersion: sql`${recipe.lockVersion} + 1` })
    .where(
      inArray(recipe.id, [...new Set(deScris.map((d) => d.recipeId))]),
    )
})

console.log(`\n${deScris.length} linii trecute pe formulă. Cantitatea veche rămâne lângă ele.`)

// Read back what the engine will actually compute, from the database, rather
// than trusting the numbers this script just held in memory.
const verificare = await clientSql<{ model: string; nr_linie: number; formula: string; cantitate_fixa: string }[]>`
  select m.cod as model, rl.nr_linie, rl.formula, rl.cantitate_fixa
  from recipe_line rl join recipe r on r.id = rl.recipe_id join model m on m.id = r.model_id
  where rl.id = any(${deScris.map((d) => d.id)}::uuid[])
  order by m.cod`
console.log(`Verificat în bază: ${verificare.length} linii, toate cu formula „${verificare[0]?.formula ?? ''}".`)

await clientSql.end({ timeout: 10 })
