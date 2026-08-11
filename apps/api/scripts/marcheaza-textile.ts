import { recipe, recipeLine } from '@samobi/shared/db'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'

/**
 * Marks the upholstery fabric on each recipe as chosen-at-bon-time.
 *
 * A recipe gives the metreage; which fabric goes on is decided when the order
 * is placed, and that is what `este_variabil` means here. The recipes imported
 * from SAGA name whichever fabric that particular run happened to use, which is
 * exactly the thing that must not be frozen into the recipe.
 *
 * Which line is the fabric is decided by how often the article repeats. What a
 * customer chooses cannot be the same article on a quarter of the catalogue:
 * OPTIMA 912 appears at half a metre in nine of the thirty-eight recipes and is
 * plainly a fixed detail, while every brand name a buyer picks — QUELLE 83,
 * VELVET 277, MANGO 1301 — shows up once or twice.
 *
 * Quantity does not decide it. An earlier cut at three metres threw out the
 * secondary fabrics — a metre of VELVET 225 beside ten of VELVET 277 — and
 * those are chosen exactly like the main one.
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

/** Above this many recipes, an article is part of the product, not a choice. */
const REPETARI_MAXIME = 3

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

const textile = linii.filter(
  (l) => !esteFunctional(l.denumire) && (repetari.get(l.cod_saga) ?? 0) <= REPETARI_MAXIME,
)

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
  `\n${excluse.length} linii în ML/M lăsate fixe — funcționale, sau în peste ` +
    `${REPETARI_MAXIME} rețete:`,
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
