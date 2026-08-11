import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { recipe, recipeLine } from '@samobi/shared/db'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

/**
 * Marks the upholstery fabric on each recipe as chosen-at-bon-time.
 *
 * A recipe gives the metreage; which fabric goes on is decided when the order
 * is placed, and that is what `este_variabil` means here. The recipes imported
 * from SAGA name whichever fabric that particular run happened to use, which is
 * exactly the thing that must not be frozen into the recipe.
 *
 * Two things decide which line is the fabric, and neither works alone.
 *
 * Rarity first: what a customer chooses cannot be the same article across the
 * range. QUELLE 83, VELVET 277, MANGO 1301 each show up once or twice; OPTIMA
 * 912 runs through sixteen recipes.
 *
 * Then metreage, but only for the ones that do repeat. OPTIMA and SHINY are on
 * a great many products and never exceed two metres — a trim, not a cover — so
 * they stay fixed, while TOSCANA 201 reaches 3,2 and is chosen. Quantity alone
 * would be wrong: an early cut at three metres threw out a metre of VELVET 225
 * sitting beside ten of VELVET 277, and that is chosen exactly like the main
 * one.
 *
 * Zips are a choice too, their colour following the fabric, but they are not
 * what was asked for; a short list of functional words keeps them out, along
 * with the wadding and the webbing.
 *
 * TESATURA POLIESTER is the exception the list cannot express. It is a plain
 * fabric, and in a recipe where nothing else is chosen it is what covers the
 * product; in a recipe that already has a branded fabric it is the lining
 * underneath. So it is judged by the company it keeps rather than by its name.
 *
 *   pnpm --filter @samobi/api marcheaza-textile
 *   pnpm --filter @samobi/api marcheaza-textile -- --scrie
 */

const scrie = process.argv.slice(2).includes('--scrie')

/** Up to this many recipes, an article is rare enough to be a choice outright. */
const REPETARI_MAXIME = 3

/** Share of a family's products that ever went out with a different one of it. */
const VARIATIE_MINIMA = 0.1

const ISTORIC = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'XLSX_10-08-2026_14-30-52.xlsx',
)

/**
 * Names that describe a function rather than a fabric. Everything a customer
 * chooses is a brand and a number — MANGO 1307, QUELLE 83, STORM 06 — while
 * everything structural says what it is.
 */
const CUVINTE_FUNCTIONALE = [
  'FERMOAR',
  'VATEX',
  'VATELINA',
  'LEZARDA',
  'CORDELINA',
  'TESATURA',
  'LONJERON',
  'BANDA',
  'ELASTIC',
  'CHINGA',
  'SFOARA',
  'SNUR',
  'PANGLICA',
  'ATA',
  'PLASA',
  'PVC',
  'FOLIE',
  'ARC',
  'BURETE',
  'RIPS',
  'DUBLURA',
  'CANT',
]

const esteFunctional = (denumire: string): boolean =>
  CUVINTE_FUNCTIONALE.some((cuvant) => denumire.toUpperCase().startsWith(cuvant))

/** The plain fabric that is a cover in some recipes and a lining in others. */
const TESATURA_SIMPLA = 'TESATURA POLIESTER'

const articole = new Map(
  (
    await clientSql<{ cod_saga: string; denumire: string; um: string }[]>`
      select cod_saga, denumire, um from saga_article`
  ).map((a) => [a.cod_saga, a]),
)

/**
 * Reads nineteen months of production bons and returns the fabric families that
 * are actually picked — the ones where the same product went out with different
 * articles of that family on different bons.
 */
function familiiCareVariaza(): Set<string> {
  const foaie = citesteXlsx(readFileSync(ISTORIC))
  const antet = foaie.randuri[0] ?? []
  const col = (nume: string) => antet.indexOf(nume)

  const produsulBonului = new Map<string, string>()
  for (const r of foaie.randuri.slice(1)) {
    const cheie = `${r[col('nr')] ?? ''}#${r[col('id_unic')] ?? ''}`
    const p = r[col('cod')] ?? ''
    if (p !== '' && !produsulBonului.has(cheie)) produsulBonului.set(cheie, p)
  }

  const peFamilie = new Map<string, Map<string, Set<string>>>()
  for (const r of foaie.randuri.slice(1)) {
    const cod = r[col('cod1')] ?? ''
    const articol = articole.get(cod)
    if (articol === undefined) continue
    const um = articol.um.trim().toUpperCase()
    if (um !== 'ML' && um !== 'M') continue

    const produs = produsulBonului.get(`${r[col('nr')] ?? ''}#${r[col('id_unic')] ?? ''}`)
    if (produs === undefined) continue

    const fam = familie(articol.denumire)
    const peProdus = peFamilie.get(fam) ?? new Map<string, Set<string>>()
    const variante = peProdus.get(produs) ?? new Set<string>()
    variante.add(cod)
    peProdus.set(produs, variante)
    peFamilie.set(fam, peProdus)
  }

  const alese = new Set<string>()
  for (const [fam, peProdus] of peFamilie) {
    const produse = [...peProdus.values()]
    if (produse.length < 3) continue
    const schimbate = produse.filter((v) => v.size > 1).length
    if (schimbate / produse.length >= VARIATIE_MINIMA) alese.add(fam)
  }
  return alese
}

// ---------------------------------------------------------------------------

interface Linie {
  id: string
  model: string
  nr_linie: number
  cod_saga: string
  um: string
  cantitate_fixa: string
  denumire: string
  recipe_id: string
}

const linii = await clientSql<Linie[]>`
  select rl.id, m.cod as model, rl.nr_linie, rl.cod_saga, rl.um,
         rl.cantitate_fixa, a.denumire, rl.recipe_id
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where rl.observatii like 'din SAGA%'
    and not rl.este_variabil
    and upper(btrim(rl.um)) in ('ML', 'M')
  order by m.cod, rl.nr_linie`

const repetari = new Map<string, number>()
for (const l of linii) repetari.set(l.cod_saga, (repetari.get(l.cod_saga) ?? 0) + 1)

const familie = (denumire: string): string =>
  denumire.trim().toUpperCase().split(/\s+/)[0] ?? ''

/** Families that change from one bon to the next, on the same product. */
const variaza = familiiCareVariaza()

const esteStofa = (l: Linie): boolean => {
  if (esteFunctional(l.denumire)) return false
  if ((repetari.get(l.cod_saga) ?? 0) <= REPETARI_MAXIME) return true
  return variaza.has(familie(l.denumire))
}

const textile = linii.filter(esteStofa)

// Second pass, for the recipes with no branded fabric in them at all: there the
// plain polyester is what the product is covered in, and it is as much a choice
// as any other. The test has to ask the database, not just this run — the lines
// marked on an earlier pass are filtered out of the query above, and without
// them every recipe looks bare.
const marcateDeja = new Set(
  (
    await clientSql<{ recipe_id: string }[]>`
      select distinct recipe_id from recipe_line where este_variabil`
  ).map((r) => r.recipe_id),
)
const cuStofa = new Set([...textile.map((l) => l.recipe_id), ...marcateDeja])
const simple = linii.filter(
  (l) => l.denumire.toUpperCase() === TESATURA_SIMPLA && !cuStofa.has(l.recipe_id),
)
textile.push(...simple)

const excluse = linii.filter((l) => !textile.includes(l))

const peModel = new Map<string, Linie[]>()
for (const l of textile) {
  const grup = peModel.get(l.model) ?? []
  grup.push(l)
  peModel.set(l.model, grup)
}

console.log(
  `\n${textile.length} linii de stofă, pe ${peModel.size} rețete din ` +
    `${new Set(linii.map((l) => l.model)).size}` +
    (simple.length > 0 ? `, din care ${simple.length} sunt ${TESATURA_SIMPLA}` : '') +
    ':\n',
)
for (const [model, grup] of [...peModel].sort()) {
  for (const l of grup) {
    console.log(
      `  ${model.padEnd(26)} linia ${String(l.nr_linie).padStart(2)}  ` +
        `${Number(l.cantitate_fixa).toString().padStart(6)} ${l.um.padEnd(3)}  ${l.denumire}`,
    )
  }
}

const faraStofa = [...new Set(linii.map((l) => l.model))].filter((m) => !peModel.has(m))
if (faraStofa.length > 0) {
  console.log(`\n${faraStofa.length} rețete nu au nicio linie recunoscută ca stofă:`)
  for (const m of faraStofa) console.log(`  ${m}`)
}

console.log(
  `\n${excluse.length} linii în ML/M lăsate fixe — funcționale, sau familii care nu se ` +
    'schimbă niciodată la același produs:',
)
const dupaDenumire = new Map<string, number>()
for (const l of excluse) {
  const cheie = l.denumire.split(/\s+/)[0] ?? l.denumire
  dupaDenumire.set(cheie, (dupaDenumire.get(cheie) ?? 0) + 1)
}
console.log(
  '  ' +
    [...dupaDenumire]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([d, n]) => `${d} (${n})`)
      .join(' · '),
)

if (textile.length === 0 || !scrie) {
  console.log('\nNimic scris. Rulează din nou cu --scrie.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

await db.transaction(async (tx) => {
  for (const l of textile) {
    // A variable line carries no article — that is the point, and the schema
    // enforces it. Which fabric this run used stays in the note.
    await tx
      .update(recipeLine)
      .set({
        esteVariabil: true,
        codSaga: null,
        categorieVariabila: 'TEXTIL',
        observatii: sql`${recipeLine.observatii} || ${` · stofa folosită atunci: ${l.cod_saga} ${l.denumire}`}`,
      })
      .where(and(eq(recipeLine.id, l.id)))
  }

  await tx
    .update(recipe)
    .set({ lockVersion: sql`${recipe.lockVersion} + 1` })
    .where(
      inArray(
        recipe.id,
        textile.map((l) => l.recipe_id),
      ),
    )
})

console.log(`\n${textile.length} linii marcate ca variabile, categoria TEXTIL.`)
console.log('La emiterea bonului, operatorul alege stofa pentru fiecare.')

await clientSql.end({ timeout: 10 })
