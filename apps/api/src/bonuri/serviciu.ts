import {
  dimension,
  model,
  recipe,
  recipeLine,
  recipeLineDimension,
  sagaArticle,
} from '@samobi/shared/db'
import {
  calculeazaConsumuri,
  type DimensiuneCeruta,
  type IntervalDimensiuni,
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
/** Either a registered dimension, or the measurements a customer asked for. */
export type CerereDimensiune =
  | { dimensiuneId: string }
  | { lungime: string; latime: string; inaltime: string | null }

export async function incarcaPentruCalcul(modelId: string, cerere: CerereDimensiune) {
  const [modelul] = await db.select().from(model).where(eq(model.id, modelId)).limit(1)
  if (modelul === undefined) throw new NuExista('Modelul nu există.')

  const interval: IntervalDimensiuni | null =
    modelul.lungimeMin !== null &&
    modelul.lungimeMax !== null &&
    modelul.latimeMin !== null &&
    modelul.latimeMax !== null
      ? {
          lungimeMin: modelul.lungimeMin,
          lungimeMax: modelul.lungimeMax,
          latimeMin: modelul.latimeMin,
          latimeMax: modelul.latimeMax,
          inaltimeMin: modelul.inaltimeMin,
          inaltimeMax: modelul.inaltimeMax,
        }
      : null

  let dimensiune: DimensiuneCeruta
  let codSagaProdus: string | null

  if ('dimensiuneId' in cerere) {
    const [dim] = await db
      .select()
      .from(dimension)
      .where(and(eq(dimension.id, cerere.dimensiuneId), eq(dimension.modelId, modelId)))
      .limit(1)

    if (dim === undefined) throw new NuExista('Dimensiunea nu aparține modelului ales.')

    dimensiune = {
      id: dim.id,
      cod: dim.cod,
      lungime: dim.lungime,
      latime: dim.latime,
      inaltime: dim.inaltime,
    }
    codSagaProdus = dim.codSagaProdus
  } else {
    dimensiune = {
      id: null,
      cod: `${Number(cerere.lungime)}×${Number(cerere.latime)}${
        cerere.inaltime === null ? '' : `×${Number(cerere.inaltime)}`
      }`,
      lungime: cerere.lungime,
      latime: cerere.latime,
      inaltime: cerere.inaltime,
    }
    // The whole model books on one article; the size stays here, on the bon.
    codSagaProdus = modelul.codSagaProdusComanda
  }

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
    interval,
    codSagaProdus,
    model: modelul,
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
    /**
     * `tabel` lines, with the values registered for each size.
     *
     * At a made-to-order size these have nothing to look up, so the screen asks
     * for the number — and shows the neighbouring registered values, which is
     * what makes the number enterable at all.
     */
    liniiTabel: linii
      .filter((l) => l.modCalcul === 'tabel')
      .map((l) => ({
        id: l.id,
        nrLinie: l.nrLinie,
        grup: l.grup,
        um: l.um,
        valori: (dupaLinie.get(l.id) ?? [])
          .filter((v) => !v.esteOverride)
          .map((v) => ({ dimensiuneId: v.dimensionId, cantitate: v.cantitate })),
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
  const context = await incarcaPentruCalcul(
    modelId,
    primaDimensiune === undefined
      ? { lungime: '1000', latime: '1000', inaltime: null }
      : { dimensiuneId: primaDimensiune.id },
  )

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
  dimensiune: CerereDimensiune
  cantitate: string
  alegeri: Record<string, string>
  valoriManuale?: Record<string, string>
}) {
  const context = await incarcaPentruCalcul(intrare.modelId, intrare.dimensiune)

  const rezultat = calculeazaConsumuri({
    reteta: context.reteta,
    dimensiune: context.dimensiune,
    cantitateProdus: intrare.cantitate,
    alegeriMateriale: new Map(Object.entries(intrare.alegeri)),
    interval: context.interval,
    valoriManuale: new Map(Object.entries(intrare.valoriManuale ?? {})),
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
