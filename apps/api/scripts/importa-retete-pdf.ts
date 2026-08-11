import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { dimension, model, recipe, recipeLine } from '@samobi/shared/db'
import { eq, sql } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { citesteSituatieBonuri, type BonPdf } from '../src/pdf/situatie-bonuri.js'

/**
 * Recipes out of SAGA's own production reports.
 *
 * The transcribed sheets gave names somebody wrote by hand, and seventy-three
 * of them never found an article. These reports give codes. Every material in
 * them is already in the catalogue, so there is nothing to match and nothing to
 * guess — which is the whole reason they are worth importing over what is
 * there.
 *
 * Two things the report does not carry, both recorded honestly rather than
 * invented: the group a material belongs to (`NECLASIFICAT`), and any split
 * between the material and its waste. The quantity is what was consumed, waste
 * included, so the loss percentage stays at zero — adding one would charge the
 * waste twice.
 *
 *   pnpm --filter @samobi/api importa-retete-pdf
 *   pnpm --filter @samobi/api importa-retete-pdf -- --scrie
 *   pnpm --filter @samobi/api importa-retete-pdf -- --scrie --inlocuieste
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')
const argumente = process.argv.slice(2).filter((a) => a !== '--')
const scrie = argumente.includes('--scrie')
const inlocuieste = argumente.includes('--inlocuieste')

/** Measurements nobody has given yet. Absurd on purpose: a plausible wrong
 * size is the kind that never gets corrected. */
const NECUNOSCUT = '1'

const FAMILII_DIN_NUME: Readonly<Record<string, string>> = {
  CANAPEA: 'CANAPEA',
  COLTAR: 'COLTAR',
  PAT: 'PAT',
  SALTEA: 'SALTEA',
}

function codModel(denumire: string): string {
  return denumire
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function familie(denumire: string): string {
  const primul = denumire.trim().toUpperCase().split(/\s+/)[0] ?? ''
  return FAMILII_DIN_NUME[primul] ?? 'ALTELE'
}

// ---------------------------------------------------------------------------

const fisiere = readdirSync(DOSAR)
  .filter((n) => n.toLowerCase().endsWith('.pdf'))
  .sort()

const bonuri: BonPdf[] = []
const fara: string[] = []

for (const nume of fisiere) {
  const gasite = citesteSituatieBonuri(readFileSync(resolve(DOSAR, nume)))
  const cuConsumuri = gasite.filter((b) => b.consumuri.length > 0)
  if (cuConsumuri.length === 0) {
    fara.push(nume)
    continue
  }
  bonuri.push(...cuConsumuri)
}

console.log(`${fisiere.length} PDF-uri în docs/, ${bonuri.length} bonuri de predare cu consumuri.`)
if (fara.length > 0) {
  console.log(`${fara.length} fără consumuri (facturi, alte documente) — ignorate.`)
}
if (bonuri.length === 0) {
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

const coduriMateriale = [...new Set(bonuri.flatMap((b) => b.consumuri.map((c) => c.codSaga)))]
const coduriProduse = [...new Set(bonuri.map((b) => b.produs.codSaga))]

const cunoscute = new Set(
  (
    await clientSql.unsafe<{ cod_saga: string }[]>(
      'select cod_saga from saga_article where cod_saga = any($1::text[])',
      [coduriMateriale.concat(coduriProduse)],
    )
  ).map((a) => a.cod_saga),
)

const lipsa = [...coduriMateriale, ...coduriProduse].filter((c) => !cunoscute.has(c))
if (lipsa.length > 0) {
  console.error(`\n${lipsa.length} coduri nu există în nomenclator: ${lipsa.slice(0, 10).join(', ')}`)
  console.error('Importă întâi nomenclatorul din SAGA.')
  await clientSql.end({ timeout: 5 })
  process.exit(1)
}

console.log(
  `${coduriProduse.length} produse, ${coduriMateriale.length} materiale distincte, ` +
    `toate în nomenclator.`,
)

// Which products already hang off a model, by code — not by name. A name match
// between „CANAPEA CORINA" and „CANAPEA CORINA E+M" is two different products.
const legate = new Map(
  (
    await clientSql<{ cod_saga_produs: string; model_id: string; model_cod: string }[]>`
      select d.cod_saga_produs, m.id as model_id, m.cod as model_cod
      from dimension d join model m on m.id = d.model_id
      where d.cod_saga_produs is not null`
  ).map((l) => [l.cod_saga_produs, l]),
)

const noi = bonuri.filter((b) => !legate.has(b.produs.codSaga))
const existente = bonuri.filter((b) => legate.has(b.produs.codSaga))

console.log(`\n${noi.length} produse noi, ${existente.length} deja legate de un model.`)

for (const b of noi) {
  console.log(`  NOU  ${codModel(b.produs.denumire).padEnd(30)} ${b.consumuri.length} linii`)
}
for (const b of existente) {
  const l = legate.get(b.produs.codSaga)
  console.log(
    `  ${inlocuieste ? 'ÎNLOCUIESC' : 'sar peste'}  ${(l?.model_cod ?? '').padEnd(30)} ` +
      `${b.consumuri.length} linii din SAGA`,
  )
}

// What replacing the existing recipes would clear from the mapping queue.
const idExistente = existente.map((b) => legate.get(b.produs.codSaga)?.model_id ?? '')
if (idExistente.length > 0) {
  const [efect] = await clientSql.unsafe<{ ocurente: number; materiale: number }[]>(
    `select count(*)::int ocurente, count(distinct o.unmapped_material_id)::int materiale
       from unmapped_material_ocurenta o
       join recipe r on r.id = o.recipe_id
      where r.model_id = any($1::uuid[]) and not o.aplicat`,
    [idExistente],
  )
  console.log(
    `\nÎnlocuirea ar șterge ${efect?.ocurente ?? 0} ocurențe nemapate, pe ${efect?.materiale ?? 0} materiale.`,
  )
}

if (!scrie) {
  console.log('\nNimic scris. Rulează din nou cu --scrie (și --inlocuieste pentru cele existente).')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

// ---------------------------------------------------------------------------

/** The catalogue's unit, for the lines whose unit cell the print dropped. */
const umCatalog = new Map(
  (
    await clientSql<{ cod_saga: string; um: string }[]>`
      select cod_saga, um from saga_article`
  ).map((a) => [a.cod_saga, a.um]),
)

function liniiPentru(bon: BonPdf) {
  return bon.consumuri.map((c, index) => ({
    nrLinie: index + 1,
    grup: 'NECLASIFICAT',
    codSaga: c.codSaga,
    esteVariabil: false,
    categorieVariabila: null,
    um: c.um ?? umCatalog.get(c.codSaga) ?? 'BUC',
    modCalcul: 'fixa',
    cantitateFixa: c.cantitate,
    formula: null,
    // The report's quantity is what left the warehouse, waste and all.
    procentPierderi: '0',
    // What the report says, not what the catalogue defaults to. Fifteen of
    // these articles are filed under MATERIALE CONSUMABILE and four under
    // IMOBILIZARI IN CURS, but every bon this factory issues discharges them
    // from MATERII PRIME.
    gestiuneDescarcare: c.gestiune,
    obligatoriu: true,
    observatii:
      `din SAGA, bon ${bon.nrIntern ?? '?'}` + (bon.data === null ? '' : ` din ${bon.data}`),
  }))
}

let modeleCreate = 0
let reteteScrise = 0

const ciocniri: string[] = []

await db.transaction(async (tx) => {
  for (const bon of noi) {
    const cod = codModel(bon.produs.denumire)

    const [modelNou] = await tx
      .insert(model)
      .values({ cod, denumire: bon.produs.denumire, familie: familie(bon.produs.denumire) })
      .onConflictDoNothing()
      .returning()

    // The derived code can land on a model that already exists — „CANAPEA
    // CORINA II." becomes CANAPEA-CORINA-II, which was transcribed from a
    // sheet. Writing into it would be a replacement, and a replacement is
    // asked for explicitly or not at all.
    if (modelNou === undefined && !inlocuieste) {
      ciocniri.push(cod)
      continue
    }

    const modelId =
      modelNou?.id ??
      (await tx.select({ id: model.id }).from(model).where(eq(model.cod, cod)).limit(1))[0]?.id
    if (modelId === undefined) continue
    if (modelNou !== undefined) modeleCreate += 1

    await tx
      .insert(dimension)
      .values({
        modelId,
        cod: 'STANDARD',
        lungime: NECUNOSCUT,
        latime: NECUNOSCUT,
        inaltime: null,
        codSagaProdus: bon.produs.codSaga,
      })
      .onConflictDoNothing()

    const [retetaNoua] = await tx
      .insert(recipe)
      .values({ modelId, versiune: 1 })
      .onConflictDoNothing()
      .returning()

    const retetaId =
      retetaNoua?.id ??
      (await tx.select({ id: recipe.id }).from(recipe).where(eq(recipe.modelId, modelId)).limit(1))[0]
        ?.id
    if (retetaId === undefined) continue

    await tx.delete(recipeLine).where(eq(recipeLine.recipeId, retetaId))
    await tx.insert(recipeLine).values(liniiPentru(bon).map((l) => ({ ...l, recipeId: retetaId })))
    reteteScrise += 1
  }

  if (inlocuieste) {
    for (const bon of existente) {
      const modelId = legate.get(bon.produs.codSaga)?.model_id
      if (modelId === undefined) continue

      const retete = await tx.select().from(recipe).where(eq(recipe.modelId, modelId))
      const retetaId = retete[0]?.id
      if (retetaId === undefined) continue

      // The queue entries describe lines of a recipe that is about to stop
      // existing; leaving them would insert duplicates the day somebody
      // resolves the name.
      await tx.execute(
        sql`delete from unmapped_material_ocurenta where recipe_id in (
              select id from recipe where model_id = ${modelId})`,
      )
      await tx.delete(recipeLine).where(eq(recipeLine.recipeId, retetaId))
      await tx.insert(recipeLine).values(liniiPentru(bon).map((l) => ({ ...l, recipeId: retetaId })))
      await tx
        .update(recipe)
        .set({ lockVersion: sql`${recipe.lockVersion} + 1` })
        .where(eq(recipe.id, retetaId))
      reteteScrise += 1
    }

  }

  // Always, not only when replacing: an occurrence points at a line number in a
  // recipe, and a recipe rewritten from SAGA no longer has those lines. Left
  // alone they would insert duplicates the day somebody resolves the name.
  await tx.execute(
    sql`delete from unmapped_material_ocurenta o
        where not o.aplicat
          and exists (select 1 from recipe_line rl
                       where rl.recipe_id = o.recipe_id
                         and rl.observatii like 'din SAGA%')`,
  )

  // A queued name with nothing left waiting on it has no decision to make.
  await tx.execute(
    sql`delete from unmapped_material u
        where not u.rezolvat
          and not exists (select 1 from unmapped_material_ocurenta o
                           where o.unmapped_material_id = u.id)`,
  )
})

if (ciocniri.length > 0) {
  console.log(
    `\n${ciocniri.length} produse au codul unui model existent și au fost sărite: ` +
      `${ciocniri.join(', ')}. Rulează cu --inlocuieste dacă vrei rețeta din SAGA peste ele.`,
  )
}

const [ramase] = await clientSql<{ n: number }[]>`
  select count(*)::int n from unmapped_material where not rezolvat`
const [linii] = await clientSql<{ n: number }[]>`select count(*)::int n from recipe_line`

console.log(`\n${modeleCreate} modele create, ${reteteScrise} rețete scrise.`)
console.log(`${linii?.n ?? 0} linii de rețetă în total, ${ramase?.n ?? 0} materiale încă nemapate.`)
console.log(
  `\nDimensiunile noi au măsuri de ${NECUNOSCUT} mm — o valoare absurdă, ca să nu treacă ` +
    'neobservată. Completează-le:',
)
console.log('  pnpm --filter @samobi/api raport-dimensiuni')

await clientSql.end({ timeout: 10 })
