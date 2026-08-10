import {
  dimension,
  recipe,
  recipeLine,
  recipeLineDimension,
  sagaArticle,
} from '@samobi/shared/db'
import {
  calculeazaConsumuri,
  type Dimensiune,
  type LinieReteta,
  type RezultatCalcul,
} from '@samobi/shared/calcul'
import { normalizeazaUm } from '@samobi/shared/nomenclator'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import { db } from '../db.js'
import { CerereInvalida, NuExista } from '../erori.js'

/**
 * Loads a recipe in the shape the calculation engine expects.
 *
 * The engine takes plain data and touches no database, which is what keeps it
 * testable; this is the seam where the two meet.
 */
export async function incarcaPentruCalcul(modelId: string, dimensiuneId: string) {
  const [dim] = await db
    .select()
    .from(dimension)
    .where(and(eq(dimension.id, dimensiuneId), eq(dimension.modelId, modelId)))
    .limit(1)

  if (dim === undefined) throw new NuExista('Dimensiunea nu aparține modelului ales.')

  const versiuni = await db
    .select()
    .from(recipe)
    .where(eq(recipe.modelId, modelId))
    .orderBy(desc(recipe.versiune))

  // The approved version, always, when there is one. A bon must be built from
  // what was signed off, not from whatever a tehnolog happens to be editing.
  // Before anything is approved, the newest draft stands in.
  const reteta = versiuni.find((r) => r.status === 'activa') ?? versiuni[0]

  if (reteta === undefined) throw new CerereInvalida('Modelul nu are rețetă.')

  const linii = await db
    .select()
    .from(recipeLine)
    .where(eq(recipeLine.recipeId, reteta.id))
    .orderBy(asc(recipeLine.nrLinie))

  if (linii.length === 0) throw new CerereInvalida('Rețeta nu are nicio linie.')

  const valori =
    linii.length === 0
      ? []
      : await db
          .select()
          .from(recipeLineDimension)
          .where(
            inArray(
              recipeLineDimension.recipeLineId,
              linii.map((l) => l.id),
            ),
          )

  const dupaLinie = new Map<string, typeof valori>()
  for (const valoare of valori) {
    const grup = dupaLinie.get(valoare.recipeLineId)
    if (grup === undefined) dupaLinie.set(valoare.recipeLineId, [valoare])
    else grup.push(valoare)
  }

  const dimensiune: Dimensiune = {
    id: dim.id,
    cod: dim.cod,
    lungime: dim.lungime,
    latime: dim.latime,
    inaltime: dim.inaltime,
  }

  const liniiCalcul: LinieReteta[] = linii.map((linie) => ({
    id: linie.id,
    nrLinie: linie.nrLinie,
    grup: linie.grup,
    codSaga: linie.codSaga,
    esteVariabil: linie.esteVariabil,
    categorieVariabila: linie.categorieVariabila,
    um: linie.um,
    modCalcul: linie.modCalcul as LinieReteta['modCalcul'],
    cantitateFixa: linie.cantitateFixa,
    formula: linie.formula,
    procentPierderi: linie.procentPierderi,
    gestiuneDescarcare: linie.gestiuneDescarcare,
    valoriPeDimensiuni: (dupaLinie.get(linie.id) ?? []).map((v) => ({
      dimensiuneId: v.dimensionId,
      cantitate: v.cantitate,
      esteOverride: v.esteOverride,
    })),
  }))

  return {
    dimensiune,
    reteta: {
      id: reteta.id,
      modelId: reteta.modelId,
      versiune: reteta.versiune,
      linii: liniiCalcul,
    },
    /** Lines whose article is chosen per bon, so the UI knows what to ask for. */
    liniiVariabile: linii
      .filter((l) => l.esteVariabil)
      .map((l) => ({
        id: l.id,
        nrLinie: l.nrLinie,
        grup: l.grup,
        um: l.um,
        categorieVariabila: l.categorieVariabila,
      })),
  }
}

export interface AvertismentUm {
  codSaga: string
  denumire: string
  umReteta: string
  umSaga: string
  /** How far off the booking would be if the quantity went over unconverted. */
  factor: number | null
}

export interface ConsumCuDenumire {
  codSaga: string
  denumire: string
  um: string
  gestiuneDescarcare: string | null
  cantitateNeta: string
  cantitateBruta: string
  umReteta: string
  cantitateBrutaRotunjita: string
  sursa: string
  contributii: RezultatCalcul['linii'][number]['contributii']
}

/** Units whose difference is a factor, not a kind. Those misbook silently. */
const FACTOR: Readonly<Record<string, number>> = { BUC: 1, SUTEB: 100, MIIB: 1000 }

/**
 * Where the recipe and the catalogue disagree about the unit.
 *
 * CAPSE 380/14 is 1,1 MIIB on the sheet — 1.100 staples — while SAGA holds the
 * article in BUC. Sent as written, SAGA books 1,1 pieces, and nothing in the
 * file looks wrong. The recipe sheets are the source of truth, so the fix is in
 * SAGA; until then this is what says so.
 */
function avertismenteUm(linii: readonly ConsumCuDenumire[]): AvertismentUm[] {
  const out: AvertismentUm[] = []
  for (const linie of linii) {
    const a = (normalizeazaUm(linie.umReteta) ?? '').toUpperCase()
    const b = (normalizeazaUm(linie.um) ?? '').toUpperCase()
    if (a === '' || b === '' || a === b) continue

    const fa = FACTOR[a]
    const fb = FACTOR[b]
    out.push({
      codSaga: linie.codSaga,
      denumire: linie.denumire,
      umReteta: linie.umReteta,
      umSaga: linie.um,
      factor: fa !== undefined && fb !== undefined ? fa / fb : null,
    })
  }
  return out
}

/** Runs the engine and attaches the catalogue names the operator needs to see. */
export async function calculeazaCuDenumiri(intrare: {
  modelId: string
  dimensiuneId: string
  cantitate: string
  alegeri: Record<string, string>
}) {
  const context = await incarcaPentruCalcul(intrare.modelId, intrare.dimensiuneId)

  const rezultat = calculeazaConsumuri({
    reteta: context.reteta,
    dimensiune: context.dimensiune,
    cantitateProdus: intrare.cantitate,
    alegeriMateriale: new Map(Object.entries(intrare.alegeri)),
  })

  const coduri = rezultat.linii.map((l) => l.codSaga)
  const articole =
    coduri.length === 0
      ? []
      : await db
          .select({
            codSaga: sagaArticle.codSaga,
            denumire: sagaArticle.denumire,
            um: sagaArticle.um,
            gestiuneImplicita: sagaArticle.gestiuneImplicita,
          })
          .from(sagaArticle)
          .where(inArray(sagaArticle.codSaga, coduri))

  const dupaCod = new Map(articole.map((a) => [a.codSaga, a]))

  const lipsa = coduri.filter((c) => !dupaCod.has(c))
  if (lipsa.length > 0) {
    throw new CerereInvalida(
      `Materiale fără corespondent în nomenclator: ${lipsa.join(', ')}. Exportul ar fi respins de SAGA.`,
    )
  }

  const linii: ConsumCuDenumire[] = rezultat.linii.map((linie) => {
    const articol = dupaCod.get(linie.codSaga)
    return {
      codSaga: linie.codSaga,
      denumire: articol?.denumire ?? linie.codSaga,
      // SAGA's own unit when it has one, because the import has to agree with
      // the catalogue. Some articles have an empty unit there, and `??` does not
      // catch an empty string — that wrote a blank UM column into the export and
      // SAGA refused the line. The recipe sheet carries the right unit, so it
      // stands in.
      um: (articol?.um ?? '').trim() === '' ? linie.um : (articol?.um ?? linie.um),
      umReteta: linie.um,
      gestiuneDescarcare: linie.gestiuneDescarcare ?? articol?.gestiuneImplicita ?? null,
      cantitateNeta: linie.cantitateNeta,
      cantitateBruta: linie.cantitateBruta,
      cantitateBrutaRotunjita: linie.cantitateBrutaRotunjita,
      sursa: linie.sursa,
      contributii: linie.contributii,
    }
  })

  return { context, rezultat, linii, avertismenteUm: avertismenteUm(linii) }
}
