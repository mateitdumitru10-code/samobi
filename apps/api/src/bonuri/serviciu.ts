import {
  dimension,
  recipe,
  recipeLine,
  recipeLineDimension,
  sagaArticle,
} from '@samobi/shared/db'
import {
  calculeazaConsumuri,
  type DimensiuneCeruta,
  type LinieReteta,
  type RezultatCalcul,
} from '@samobi/shared/calcul'
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

  const dimensiune: DimensiuneCeruta = {
    id: dim.id,
    cod: dim.cod,
    lungime: dim.lungime,
    latime: dim.latime,
    inaltime: dim.inaltime,
  }

  // One recipe per model, edited in place. The bon still pins its id, and each
  // bon line carries the formula it was computed from, so a document stays
  // explicable after the recipe moves on — but it can no longer be recomputed
  // from the recipe, which is the price of dropping versions.
  const [reteta] = await db
    .select()
    .from(recipe)
    .where(eq(recipe.modelId, modelId))
    .orderBy(desc(recipe.versiune))
    .limit(1)

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
    codSagaProdus: dim.codSagaProdus,
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

/**
 * The recipe, every registered size, and the article names — without picking a
 * size first. What a comparison across sizes needs and a bon does not.
 */
export async function incarcaPentruComparatie(modelId: string) {
  const dimensiuni = await db
    .select()
    .from(dimension)
    .where(and(eq(dimension.modelId, modelId), eq(dimension.activ, true)))
    .orderBy(asc(dimension.cod))

  const primaDimensiune = dimensiuni[0]
  if (primaDimensiune === undefined) throw new CerereInvalida('Modelul nu are dimensiuni.')
  const context = await incarcaPentruCalcul(modelId, primaDimensiune.id)

  const coduri = context.reteta.linii
    .map((l) => l.codSaga)
    .filter((c): c is string => c !== null && c !== '')

  const articole =
    coduri.length === 0
      ? []
      : await db
          .select({ codSaga: sagaArticle.codSaga, denumire: sagaArticle.denumire })
          .from(sagaArticle)
          .where(inArray(sagaArticle.codSaga, [...new Set(coduri)]))

  return {
    reteta: context.reteta,
    dimensiuni,
    denumiri: new Map(articole.map((a) => [a.codSaga, a.denumire])),
  }
}

export interface ConsumCuDenumire {
  codSaga: string
  denumire: string
  um: string
  gestiuneDescarcare: string | null
  cantitateNeta: string
  cantitateBruta: string
  cantitateBrutaRotunjita: string
  sursa: string
  contributii: RezultatCalcul['linii'][number]['contributii']
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
      /**
       * The recipe's unit, always.
       *
       * SAGA's import takes the unit from the file rather than from the article
       * it already holds, so the file is what defines the booking. The sheets
       * are the source of truth, and this is where that becomes literal.
       */
      um: linie.um,
      gestiuneDescarcare: linie.gestiuneDescarcare ?? articol?.gestiuneImplicita ?? null,
      cantitateNeta: linie.cantitateNeta,
      cantitateBruta: linie.cantitateBruta,
      cantitateBrutaRotunjita: linie.cantitateBrutaRotunjita,
      sursa: linie.sursa,
      contributii: linie.contributii,
    }
  })

  return { context, rezultat, linii }
}
