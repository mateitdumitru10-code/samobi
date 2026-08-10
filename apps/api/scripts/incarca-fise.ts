import {
  dimension,
  model,
  profile,
  recipe,
  recipeLine,
  sagaArticle,
  unmappedMaterial,
} from '@samobi/shared/db'
import { potrivireSigura, sugereaza, type Candidat } from '@samobi/shared/nomenclator'
import { asc, eq } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'

import { FISE, type Fisa, type LinieFisa } from './fise.js'

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

const scrie = process.argv.includes('--scrie')

const [autor] = await db
  .select({ id: profile.id, nume: profile.nume })
  .from(profile)
  .orderBy(asc(profile.creatLa))
  .limit(1)

if (autor === undefined) {
  console.error('Nu există niciun utilizator. Rulează întâi bootstrap-admin.')
  process.exit(1)
}

const catalog: Candidat[] = (
  await db
    .select({ codSaga: sagaArticle.codSaga, denumire: sagaArticle.denumire })
    .from(sagaArticle)
    .where(eq(sagaArticle.activ, true))
).map((a) => ({ codSaga: a.codSaga, denumire: a.denumire }))

console.log(`Catalog: ${catalog.length} articole active.\n`)

interface Potrivire {
  linie: LinieFisa
  codSaga: string | null
  denumireGasita: string | null
  scor: number
  alternative: { codSaga: string; denumire: string; scor: number }[]
}

function potriveste(linie: LinieFisa): Potrivire {
  if (linie.variabil === true) {
    return { linie, codSaga: null, denumireGasita: null, scor: 1, alternative: [] }
  }
  const sugestii = sugereaza(linie.denumire, catalog, { limita: 3, prag: 0.3 })
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

  const potriviri = fisa.linii.map(potriveste)
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
    const semn = p.scor >= 0.85 ? ' ' : '?'
    console.log(
      `${semn} ${String(p.linie.nr).padStart(2)}  ${p.linie.denumire.padEnd(26)} → ${p.codSaga} ${(p.denumireGasita ?? '').padEnd(28)} ${Math.round(p.scor * 100)}%`,
    )
  }

  console.log(
    `  ${potrivite.length} linii intră în rețetă, ${nepotrivite.length} merg în coada de nemapate.`,
  )

  if (!scrie) return

  const [creat] = await db
    .insert(model)
    .values({
      cod: fisa.cod,
      denumire: fisa.denumire,
      familie: fisa.familie,
      creatDe: autor?.id ?? null,
    })
    .onConflictDoNothing()
    .returning()

  if (creat === undefined) {
    console.log('  Modelul există deja; îl las neatins.')
    return
  }

  await db.insert(dimension).values({
    modelId: creat.id,
    cod: fisa.dimensiune.cod,
    lungime: fisa.dimensiune.lungime,
    latime: fisa.dimensiune.latime,
    inaltime: fisa.dimensiune.inaltime,
  })

  const [reteta] = await db
    .insert(recipe)
    .values({ modelId: creat.id, versiune: 1, status: 'draft', creatDe: autor?.id ?? null })
    .returning()

  if (reteta === undefined) throw new Error('Rețeta nu a putut fi creată.')

  let nr = 0
  for (const p of potrivite) {
    nr += 1
    await db.insert(recipeLine).values({
      recipeId: reteta.id,
      nrLinie: nr,
      grup: p.linie.grup,
      codSaga: p.codSaga,
      esteVariabil: p.linie.variabil === true,
      categorieVariabila: p.linie.variabil === true ? 'TEXTIL' : null,
      um: p.linie.um,
      modCalcul: 'fixa',
      cantitateFixa: p.linie.cantitate,
      procentPierderi: '0',
      observatii: `din ${fisa.sursa}, poziția ${p.linie.nr}`,
    })
  }

  for (const p of nepotrivite) {
    await db
      .insert(unmappedMaterial)
      .values({
        denumireExterna: p.linie.denumire,
        sugestieCodSaga: p.alternative[0]?.codSaga ?? null,
      })
      .onConflictDoNothing()
  }

  console.log(`  Scris: model ${creat.cod}, ${nr} linii.`)
}

for (const fisa of FISE) {
  await incarca(fisa)
}

if (!scrie) {
  console.log('\nNimic nu a fost scris. Rulează din nou cu --scrie dacă potrivirile arată bine.')
}

await clientSql.end({ timeout: 10 })
