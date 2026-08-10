import {
  dimension,
  model,
  profile,
  recipe,
  recipeLine,
  sagaArticle,
  unmappedMaterial,
  unmappedMaterialOcurenta,
} from '@samobi/shared/db'
import { potrivireSigura, sugereaza, type Candidat } from '@samobi/shared/nomenclator'
import { asc, eq } from 'drizzle-orm'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { clientSql, db } from '../src/db.js'

import { type Fisa, type LinieFisa } from './fise.js'
import { toateFisele } from './fise-json.js'

/**
 * Loads the transcribed recipe sheets so there is something real to try the
 * application on.
 *
 * The sheets carry no SAGA codes, so every material is matched against the
 * catalogue by name. A confident match is used; anything doubtful is left out
 * of the recipe and pushed into the unmapped queue, where a tehnolog decides.
 * Guessing here would put a wrong article on a real bon.
 *
 *   pnpm --filter @samobi/api incarca-fise            # raportează, nu scrie
 *   pnpm --filter @samobi/api incarca-fise -- --scrie
 */

/**
 * Decisions a tehnolog already made, keyed `MODEL#poziție`.
 *
 * These beat any similarity score: a person looked at the sheet and the
 * catalogue and chose. Written by aplica-mapari from the filled worksheet.
 */
const mapari: Record<string, string> = (() => {
  try {
    return JSON.parse(
      readFileSync(resolve(import.meta.dirname, 'mapari.json'), 'utf8'),
    ) as Record<string, string>
  } catch {
    return {}
  }
})()

const scrie = process.argv.includes('--scrie')
/** Replaces the lines of a recipe that already exists, instead of skipping it. */
const reincarca = process.argv.includes('--reincarca')

const [autor] = await db
  .select({ id: profile.id, nume: profile.nume })
  .from(profile)
  .orderBy(asc(profile.creatLa))
  .limit(1)

if (autor === undefined) {
  console.error('Nu există niciun utilizator. Rulează întâi bootstrap-admin.')
  process.exit(1)
}

const toate = await db
  .select({
    codSaga: sagaArticle.codSaga,
    denumire: sagaArticle.denumire,
    tip: sagaArticle.tip,
  })
  .from(sagaArticle)
  .where(eq(sagaArticle.activ, true))

/**
 * Raw materials first, everything else only as a fallback.
 *
 * The catalogue holds duplicate codes: 00000662 CUIE is an obsolete entry typed
 * `altele`, sitting in IMOBILIZARI IN CURS with no unit, while 00001228 CUIE is
 * the raw material. Matching on name alone picked the obsolete one, because the
 * name was identical. A recipe consumes materials, so that is where to look.
 */
const materiiPrime: Candidat[] = toate
  .filter((a) => a.tip === 'materie_prima')
  .map((a) => ({ codSaga: a.codSaga, denumire: a.denumire }))

const catalog: Candidat[] = toate.map((a) => ({ codSaga: a.codSaga, denumire: a.denumire }))

console.log(
  `Catalog: ${catalog.length} articole active, din care ${materiiPrime.length} materii prime.\n`,
)

interface Potrivire {
  linie: LinieFisa
  codSaga: string | null
  denumireGasita: string | null
  scor: number
  alternative: { codSaga: string; denumire: string; scor: number }[]
  /** Chosen by a person rather than by the matcher. */
  manual?: boolean
}

function potriveste(linie: LinieFisa, codModel: string): Potrivire {
  if (linie.variabil === true) {
    return { linie, codSaga: null, denumireGasita: null, scor: 1, alternative: [] }
  }

  const ales = mapari[`${codModel}#${linie.nr}`]
  if (ales !== undefined) {
    const articol = toate.find((a) => a.codSaga === ales)
    return {
      linie,
      codSaga: ales,
      denumireGasita: articol?.denumire ?? '(cod ales manual)',
      scor: 1,
      alternative: [],
      manual: true,
    }
  }
  const dinMateriiPrime = sugereaza(linie.denumire, materiiPrime, { limita: 3, prag: 0.3 })
  const sigurDinMateriiPrime =
    dinMateriiPrime[0] !== undefined &&
    potrivireSigura(linie.denumire, dinMateriiPrime[0].denumire, dinMateriiPrime[0].scor)

  const sugestii = sigurDinMateriiPrime
    ? dinMateriiPrime
    : sugereaza(linie.denumire, catalog, { limita: 3, prag: 0.3 })

  const prima = sugestii[0]
  if (prima === undefined || !potrivireSigura(linie.denumire, prima.denumire, prima.scor)) {
    return {
      linie,
      codSaga: null,
      denumireGasita: null,
      scor: prima?.scor ?? 0,
      alternative: sugestii,
    }
  }
  return {
    linie,
    codSaga: prima.codSaga,
    denumireGasita: prima.denumire,
    scor: prima.scor,
    alternative: sugestii.slice(1),
  }
}

async function incarca(fisa: Fisa) {
  console.log(`\n=== ${fisa.denumire} (${fisa.linii.length} linii) ===`)

  const potriviri = fisa.linii.map((linie) => potriveste(linie, fisa.cod))
  const nepotrivite = potriviri.filter((p) => p.codSaga === null && p.linie.variabil !== true)
  const potrivite = potriviri.filter((p) => p.codSaga !== null || p.linie.variabil === true)

  for (const p of potriviri) {
    if (p.linie.variabil === true) {
      console.log(`  ${String(p.linie.nr).padStart(2)}  ${p.linie.denumire.padEnd(26)} → VARIABIL`)
      continue
    }
    if (p.codSaga === null) {
      const cel_mai_bun =
        p.alternative[0] === undefined
          ? 'nimic apropiat'
          : `${p.alternative[0].codSaga} ${p.alternative[0].denumire} (${Math.round(p.alternative[0].scor * 100)}%)`
      console.log(
        `  ${String(p.linie.nr).padStart(2)}  ${p.linie.denumire.padEnd(26)} → NEPOTRIVIT, cel mai apropiat: ${cel_mai_bun}`,
      )
      continue
    }
    const semn = p.manual === true ? 'M' : p.scor >= 0.85 ? ' ' : '?'
    console.log(
      `${semn} ${String(p.linie.nr).padStart(2)}  ${p.linie.denumire.padEnd(26)} → ${p.codSaga} ${(p.denumireGasita ?? '').padEnd(28)} ${Math.round(p.scor * 100)}%`,
    )
  }

  console.log(
    `  ${potrivite.length} linii intră în rețetă, ${nepotrivite.length} merg în coada de nemapate.`,
  )

  if (!scrie) return

  const [existent] = await db.select().from(model).where(eq(model.cod, fisa.cod)).limit(1)

  if (existent !== undefined && !reincarca) {
    console.log('  Modelul există deja; îl las neatins. Folosește --reincarca pentru a-l reface.')
    return
  }

  let modelId: string
  let retetaId: string

  if (existent !== undefined) {
    // The model, its dimension and its recipe row all keep their ids, so any bon
    // already issued against them survives. Only the lines are replaced.
    modelId = existent.id
    const [retetaExistenta] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.modelId, modelId))
      .limit(1)
    if (retetaExistenta === undefined) throw new Error('Modelul există fără rețetă.')
    retetaId = retetaExistenta.id

    await db.delete(recipeLine).where(eq(recipeLine.recipeId, retetaId))
    await db
      .delete(unmappedMaterialOcurenta)
      .where(eq(unmappedMaterialOcurenta.recipeId, retetaId))
    await db
      .update(recipe)
      .set({ lockVersion: retetaExistenta.lockVersion + 1 })
      .where(eq(recipe.id, retetaId))
    console.log('  Model existent: înlocuiesc liniile, păstrez bonurile.')
  } else {
    const [creat] = await db
      .insert(model)
      .values({
        cod: fisa.cod,
        denumire: fisa.denumire,
        familie: fisa.familie,
        creatDe: autor?.id ?? null,
      })
      .returning()
    if (creat === undefined) throw new Error('Modelul nu a putut fi creat.')
    modelId = creat.id

    await db.insert(dimension).values({
      modelId,
      cod: fisa.dimensiune.cod,
      lungime: fisa.dimensiune.lungime,
      latime: fisa.dimensiune.latime,
      inaltime: fisa.dimensiune.inaltime,
    })

    const [reteta] = await db
      .insert(recipe)
      .values({ modelId, versiune: 1, status: 'draft', creatDe: autor?.id ?? null })
      .returning()
    if (reteta === undefined) throw new Error('Rețeta nu a putut fi creată.')
    retetaId = reteta.id
  }

  for (const p of potrivite) {
    await db.insert(recipeLine).values({
      recipeId: retetaId,
      // The sheet's own position, gaps included. A line numbered 27 in the app
      // is line 27 on the paper the tehnolog is holding.
      nrLinie: p.linie.nr,
      grup: p.linie.grup,
      codSaga: p.codSaga,
      esteVariabil: p.linie.variabil === true,
      categorieVariabila: p.linie.variabil === true ? 'TEXTIL' : null,
      um: p.linie.um,
      modCalcul: 'fixa',
      cantitateFixa: p.linie.cantitate,
      procentPierderi: '0',
      observatii: `${fisa.sursa} (${fisa.pagini.join('+')}), poziția ${p.linie.nr}`,
    })
  }

  // The queue records the name once and every place it appears. Resolving the
  // name then completes each recipe that was waiting on it, instead of noting a
  // decision that changes nothing.
  for (const p of nepotrivite) {
    const [material] = await db
      .insert(unmappedMaterial)
      .values({
        denumireExterna: p.linie.denumire,
        sugestieCodSaga: p.alternative[0]?.codSaga ?? null,
        sugestii: p.alternative.map((a) => ({
          codSaga: a.codSaga,
          denumire: a.denumire,
          scor: Math.round(a.scor * 100),
        })),
      })
      .onConflictDoUpdate({
        target: unmappedMaterial.denumireExterna,
        set: {
          sugestieCodSaga: p.alternative[0]?.codSaga ?? null,
          sugestii: p.alternative.map((a) => ({
            codSaga: a.codSaga,
            denumire: a.denumire,
            scor: Math.round(a.scor * 100),
          })),
        },
      })
      .returning({ id: unmappedMaterial.id })

    if (material === undefined) continue

    await db
      .insert(unmappedMaterialOcurenta)
      .values({
        unmappedMaterialId: material.id,
        recipeId: retetaId,
        nrLinie: p.linie.nr,
        grup: p.linie.grup,
        um: p.linie.um,
        cantitate: p.linie.cantitate,
      })
      .onConflictDoNothing()
  }

  console.log(`  Scris: ${fisa.cod}, ${potrivite.length} linii.`)
}

const fise = toateFisele()
console.log(`${fise.length} fișe de încărcat.\n`)

for (const fisa of fise) {
  await incarca(fisa)
}

if (!scrie) {
  console.log('\nNimic nu a fost scris. Rulează din nou cu --scrie dacă potrivirile arată bine.')
}

await clientSql.end({ timeout: 10 })
