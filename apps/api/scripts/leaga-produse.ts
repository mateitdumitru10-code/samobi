import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { dimension, model, sagaArticle } from '@samobi/shared/db'
import { scorSimilaritate } from '@samobi/shared/nomenclator'
import { and, eq, isNull } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

/**
 * Points each model's dimension at the SAGA article it is booked as.
 *
 * Name similarity alone is not enough here: the catalogue holds CANAPEA CORINA,
 * CANAPEA CORINA 1200, CANAPEA CORINA 1250 and a dozen more, all scoring alike.
 * The production history breaks the tie — the code the factory actually issues
 * bons against is the code the recipe belongs to, and one with 23 bons beats one
 * with two.
 *
 *   pnpm --filter @samobi/api leaga-produse            # raportează
 *   pnpm --filter @samobi/api leaga-produse -- --scrie
 */

const scrie = process.argv.includes('--scrie')
const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

/**
 * Decisions a person made, model code → SAGA article.
 *
 * The heuristic below deliberately refuses anything it is not sure of, and it
 * is right to: CANAPEA CORINA and CANAPEA CORINA 1200 score alike and only
 * someone who knows the product can separate them. What that leaves is a short
 * list of questions, and these are the answers — kept here rather than applied
 * once by hand, so a rebuilt database ends up in the same place.
 *
 * `PAT DAVID 1400/2000` for a model called 2000X1400 is deliberate: the same
 * bed, written the other way round.
 */
const DECIZII: Readonly<Record<string, string>> = {
  'FOTOLIU-CORINA': '00000202',
  'HOL-CORINA-311': '00005835',
  'HOL-VISION-311': '00006940',
  'PAT-DAVID-2000X1400': '00001654',
  'PAT-PAUL-2000X1600-CU-SOMIERA': '00025134',
  // Three recipes, one finished product: the kit and the prototype differ in
  // what they consume, not in what leaves the factory.
  'COLTAR-TORRO-CU-KIT-POLIURETAN': '00017073',
  'COLTAR-TORRO-PROTOTIP': '00017073',
}

/** How many bons each finished-product code carries, from the production export. */
function bonuriPerProdus(): Map<string, number> {
  const numar = new Map<string, number>()

  for (const nume of readdirSync(DOSAR).filter((n) => n.endsWith('.xlsx')).sort().reverse()) {
    let foaie
    try {
      foaie = citesteXlsx(readFileSync(resolve(DOSAR, nume)))
    } catch {
      continue
    }
    if (foaie.nume !== 'Productie') continue

    const antet = foaie.randuri[0] ?? []
    const iNr = antet.indexOf('nr')
    const iId = antet.indexOf('id_unic')
    const iCod = antet.indexOf('cod')

    const vazute = new Set<string>()
    for (const r of foaie.randuri.slice(1)) {
      const cod = r[iCod] ?? ''
      const cheie = `${r[iNr] ?? ''}#${r[iId] ?? ''}`
      if (cod === '' || vazute.has(cheie)) continue
      vazute.add(cheie)
      numar.set(cod, (numar.get(cod) ?? 0) + 1)
    }
    console.log(`Istoric: ${nume}, ${numar.size} produse cu bonuri.`)
    return numar
  }

  console.log('Fără export de producție — leg doar după denumire.')
  return numar
}

const bonuri = bonuriPerProdus()

const produse = await db
  .select({ codSaga: sagaArticle.codSaga, denumire: sagaArticle.denumire, um: sagaArticle.um })
  .from(sagaArticle)
  .where(and(eq(sagaArticle.tip, 'produs'), eq(sagaArticle.activ, true)))

const deLegat = await db
  .select({
    dimensiuneId: dimension.id,
    modelCod: model.cod,
    modelDenumire: model.denumire,
  })
  .from(dimension)
  .innerJoin(model, eq(model.id, dimension.modelId))
  // Retired models keep their dimensions; nobody needs to choose an article for
  // a product that is no longer on the list.
  .where(and(isNull(dimension.codSagaProdus), eq(model.activ, true), eq(dimension.activ, true)))

console.log(`${deLegat.length} dimensiuni fără produs finit.\n`)

let legate = 0

for (const rand of deLegat) {
  const decis = DECIZII[rand.modelCod]
  if (decis !== undefined) {
    const articol = produse.find((p) => p.codSaga === decis)
    if (articol === undefined) {
      console.log(`! ${rand.modelCod.padEnd(30)} → ${decis} nu e un produs activ în nomenclator`)
      continue
    }
    console.log(`✓ ${rand.modelCod.padEnd(30)} → ${decis} ${articol.denumire}  (decis)`)
    if (scrie) {
      await db
        .update(dimension)
        .set({ codSagaProdus: decis })
        .where(eq(dimension.id, rand.dimensiuneId))
      legate += 1
    }
    continue
  }

  const candidati = produse
    .map((p) => ({
      ...p,
      scor: scorSimilaritate(rand.modelDenumire, p.denumire),
      bonuri: bonuri.get(p.codSaga) ?? 0,
    }))
    .filter((p) => p.scor >= 0.5)
    // The name decides; production only breaks a tie between names that are
    // equally close. Sorting the other way round sent CANAPEA SORINA to CANAPEA
    // VISION purely because that code carries 289 bons.
    .sort((a, b) => b.scor - a.scor || b.bonuri - a.bonuri)
    .slice(0, 3)

  const ales = candidati[0]
  const alDoilea = candidati[1]
  const sigur =
    ales !== undefined &&
    ales.bonuri > 0 &&
    ales.scor >= 0.8 &&
    // A clear lead, or the runner-up is just as plausible and a person should
    // look: CANAPEA CORINA against CANAPEA CORINA 1200 is not ours to settle.
    (alDoilea === undefined || ales.scor - alDoilea.scor >= 0.1)

  const eticheta = candidati
    .map((c) => `${c.codSaga} ${c.denumire.slice(0, 30)} (${Math.round(c.scor * 100)}%, ${c.bonuri} bonuri)`)
    .join('  |  ')

  console.log(
    `${sigur ? '✓' : ' '} ${rand.modelCod.padEnd(30)} → ${eticheta === '' ? 'niciun candidat' : eticheta}`,
  )

  if (sigur && scrie && ales !== undefined) {
    await db
      .update(dimension)
      .set({ codSagaProdus: ales.codSaga })
      .where(eq(dimension.id, rand.dimensiuneId))
    legate += 1
  }
}

console.log(
  scrie
    ? `\n${legate} dimensiuni legate. Restul rămân de ales manual.`
    : '\nNimic scris. Rulează cu --scrie dacă potrivirile arată bine.',
)

await clientSql.end({ timeout: 10 })
