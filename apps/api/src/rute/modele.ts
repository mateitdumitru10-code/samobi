import {
  dimension,
  model,
  productionOrder,
  recipe,
  recipeLine,
  recipeLineDimension,
  sagaArticle,
} from '@samobi/shared/db'
import {
  cantitatiPeLinie,
  EroareCalcul,
  valideazaFormulaPeInterval,
  type DimensiuneCeruta,
} from '@samobi/shared/calcul'
import {
  schemaDimensiune,
  schemaDimensiuneBaza,
  schemaLaComanda,
  schemaModel,
  schemaModificareModel,
  type LaComanda,
} from '@samobi/shared/scheme'
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { scrieAudit } from '../audit.js'
import { autentifica, ceruRol, TOTI, utilizatorul, type VerificatorToken } from '../auth.js'
import { incarcaPentruComparatie } from '../bonuri/serviciu.js'
import { db } from '../db.js'
import { CerereInvalida, codPostgres, Conflict, NuExista } from '../erori.js'

const schemaId = z.object({ id: z.string().uuid('Identificator invalid.') })
const schemaIdDimensiune = z.object({
  id: z.string().uuid(),
  dimensiuneId: z.string().uuid(),
})

/** Postgres unique-violation, which is how a duplicate code announces itself. */
function esteDuplicat(err: unknown): boolean {
  return codPostgres(err) === '23505'
}

export interface AvertismentLaComanda {
  fel: 'formula' | 'tabel' | 'override' | 'cod-lipsa'
  nrLinie: number | null
  mesaj: string
}

/**
 * What would go wrong if this model were issued at the extremes of its range.
 *
 * Three species of silent nonsense, and only the first is mechanical: a formula
 * that stops being a positive number. The other two are judgement — a `tabel`
 * line has no value at an unregistered size and will be asked of the operator,
 * and an override never fires at one, so the formula it was created to correct
 * runs instead. Both are worth saying out loud once, here.
 */
async function verificaFormulele(
  modelId: string,
  interval: LaComanda,
): Promise<AvertismentLaComanda[]> {
  if (interval.lungimeMin === null || interval.latimeMin === null) return []

  const versiuni = await db
    .select()
    .from(recipe)
    .where(eq(recipe.modelId, modelId))
    .orderBy(desc(recipe.versiune))
  const reteta = versiuni.find((r) => r.status === 'activa') ?? versiuni[0]
  if (reteta === undefined) return []

  const linii = await db
    .select()
    .from(recipeLine)
    .where(eq(recipeLine.recipeId, reteta.id))
    .orderBy(asc(recipeLine.nrLinie))

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

  const numere = {
    lungimeMin: Number(interval.lungimeMin),
    lungimeMax: Number(interval.lungimeMax),
    latimeMin: Number(interval.latimeMin),
    latimeMax: Number(interval.latimeMax),
    inaltimeMin: interval.inaltimeMin === null ? null : Number(interval.inaltimeMin),
    inaltimeMax: interval.inaltimeMax === null ? null : Number(interval.inaltimeMax),
  }

  const avertismente: AvertismentLaComanda[] = []

  if (interval.codSagaProdusComanda === null) {
    avertismente.push({
      fel: 'cod-lipsa',
      nrLinie: null,
      mesaj:
        'Modelul nu are cod de predare pentru dimensiunile la comandă. Bonurile vor fi blocate ' +
        'până îl legi.',
    })
  }

  for (const linie of linii) {
    if (linie.modCalcul === 'formula' && linie.formula !== null) {
      try {
        const rele = valideazaFormulaPeInterval(linie.formula, numere, linie.nrLinie)
        for (const punct of rele) {
          avertismente.push({
            fel: 'formula',
            nrLinie: linie.nrLinie,
            mesaj:
              `„${linie.formula}" ${punct.motiv} la ${punct.L}×${punct.l}` +
              `${punct.H === null ? '' : `×${punct.H}`}.`,
          })
        }
      } catch (err) {
        if (err instanceof EroareCalcul) {
          avertismente.push({ fel: 'formula', nrLinie: linie.nrLinie, mesaj: err.message })
        } else throw err
      }
    }

    if (linie.modCalcul === 'tabel') {
      avertismente.push({
        fel: 'tabel',
        nrLinie: linie.nrLinie,
        mesaj:
          `Linia e pe mod „tabel" (${linie.grup}, ${linie.um}). La fiecare bon la comandă, ` +
          'cantitatea va fi cerută operatorului.',
      })
    }

    const areOverride = valori.some((v) => v.recipeLineId === linie.id && v.esteOverride)
    if (areOverride) {
      avertismente.push({
        fel: 'override',
        nrLinie: linie.nrLinie,
        mesaj:
          'Linia are o valoare fixată manual pe o dimensiune înregistrată. La comandă nu se ' +
          'aplică — se folosește formula liniei.',
      })
    }
  }

  return avertismente
}

export function ruteModele(app: FastifyInstance, verifica: VerificatorToken) {
  const oricine = {
    preHandler: [autentifica(verifica), ceruRol(...TOTI)],
  }
  const doarTehnolog = { preHandler: [autentifica(verifica), ceruRol(...TOTI)] }

  app.get('/modele', oricine, async (cerere) => {
    const { includeInactive } = z
      .object({ includeInactive: z.enum(['true', 'false']).optional() })
      .parse(cerere.query)

    const randuri = await db
      .select({
        id: model.id,
        cod: model.cod,
        denumire: model.denumire,
        familie: model.familie,
        umProdus: model.umProdus,
        activ: model.activ,
        modificatLa: model.modificatLa,
      })
      .from(model)
      .where(includeInactive === 'true' ? undefined : eq(model.activ, true))
      .orderBy(asc(model.denumire))

    // Two counts the list is useless without: does this model have dimensions,
    // and does it have a recipe at all.
    const dimensiuni = await db
      .select({ modelId: dimension.modelId, n: count() })
      .from(dimension)
      .where(eq(dimension.activ, true))
      .groupBy(dimension.modelId)

    const retete = await db
      .select({ modelId: recipe.modelId, n: count() })
      .from(recipe)
      .groupBy(recipe.modelId)

    const dupaModelDim = new Map(dimensiuni.map((d) => [d.modelId, d.n]))
    const dupaModelRet = new Map(retete.map((r) => [r.modelId, r.n]))

    return randuri.map((m) => ({
      ...m,
      modificatLa: m.modificatLa.toISOString(),
      nrDimensiuni: dupaModelDim.get(m.id) ?? 0,
      nrRetete: dupaModelRet.get(m.id) ?? 0,
    }))
  })

  app.post('/modele', doarTehnolog, async (cerere, raspuns) => {
    const date = schemaModel.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    try {
      const [creat] = await db
        .insert(model)
        .values({ ...date, creatDe: utilizator.id })
        .returning()

      await scrieAudit(cerere, {
        userId: utilizator.id,
        entitate: 'model',
        entitateId: creat?.id ?? date.cod,
        actiune: 'creare',
        diff: date,
      })

      return raspuns.status(201).send(creat)
    } catch (err) {
      if (esteDuplicat(err)) throw new Conflict(`Există deja un model cu codul ${date.cod}.`)
      throw err
    }
  })

  app.patch('/modele/:id', doarTehnolog, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const modificari = schemaModificareModel.parse(cerere.body)

    const [actualizat] = await db
      .update(model)
      .set(modificari)
      .where(eq(model.id, id))
      .returning()

    if (actualizat === undefined) throw new NuExista('Modelul nu există.')
    return actualizat
  })

  app.get('/modele/:id', oricine, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)

    const [gasit] = await db.select().from(model).where(eq(model.id, id)).limit(1)
    if (gasit === undefined) throw new NuExista('Modelul nu există.')

    const dimensiuni = await db
      .select({
        id: dimension.id,
        cod: dimension.cod,
        lungime: dimension.lungime,
        latime: dimension.latime,
        inaltime: dimension.inaltime,
        codSagaProdus: dimension.codSagaProdus,
        activ: dimension.activ,
        denumireProdus: sagaArticle.denumire,
      })
      .from(dimension)
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, dimension.codSagaProdus))
      .where(eq(dimension.modelId, id))
      .orderBy(asc(dimension.cod))

    // The made-to-order article's name, so the card can show what the code is
    // rather than only that there is one.
    let denumireProdusComanda: string | null = null
    if (gasit.codSagaProdusComanda !== null) {
      const [articol] = await db
        .select({ denumire: sagaArticle.denumire })
        .from(sagaArticle)
        .where(eq(sagaArticle.codSaga, gasit.codSagaProdusComanda))
        .limit(1)
      denumireProdusComanda = articol?.denumire ?? null
    }

    return {
      ...gasit,
      modificatLa: gasit.modificatLa.toISOString(),
      denumireProdusComanda,
      dimensiuni,
    }
  })

  /**
   * Opens a model to made-to-order sizes, or closes it.
   *
   * The range is a claim that the recipe's formulas hold across it, so this is
   * where that claim is checked: every formula is evaluated at the corners of
   * the declared interval, and the ones that stop making sense are reported
   * rather than discovered by an operator with a customer on the phone. They
   * are reported, not refused — the tehnolog may be declaring the range first
   * and fixing the formulas next, and blocking that order of work helps nobody.
   */
  app.put('/modele/:id/la-comanda', doarTehnolog, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const date = schemaLaComanda.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const [existent] = await db.select().from(model).where(eq(model.id, id)).limit(1)
    if (existent === undefined) throw new NuExista('Modelul nu există.')

    const cod = date.codSagaProdusComanda === '' ? null : date.codSagaProdusComanda
    if (cod !== null) {
      const [articol] = await db
        .select({ tip: sagaArticle.tip })
        .from(sagaArticle)
        .where(eq(sagaArticle.codSaga, cod))
        .limit(1)
      if (articol === undefined) throw new CerereInvalida(`Codul ${cod} nu există în nomenclator.`)
      if (articol.tip !== 'produs') {
        throw new CerereInvalida(`Codul ${cod} nu este produs finit în SAGA, ci ${articol.tip}.`)
      }
    }

    const [actualizat] = await db
      .update(model)
      .set({
        lungimeMin: date.lungimeMin,
        lungimeMax: date.lungimeMax,
        latimeMin: date.latimeMin,
        latimeMax: date.latimeMax,
        inaltimeMin: date.inaltimeMin,
        inaltimeMax: date.inaltimeMax,
        codSagaProdusComanda: cod,
      })
      .where(eq(model.id, id))
      .returning()

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'model',
      entitateId: id,
      actiune: 'modificare',
      diff: { laComanda: date },
    })

    return { ...actualizat, avertismente: await verificaFormulele(id, date) }
  })

  /**
   * The recipe's quantities side by side, at every size the model is built in.
   *
   * This is where „ce se schimbă când se schimbă dimensiunea" gets an answer.
   * A line that is the same number in every column is either genuinely
   * size-independent — four legs are four legs — or a constant nobody has
   * turned into a formula yet, and seeing the two next to each other is how the
   * difference becomes obvious.
   */
  app.get('/modele/:id/comparatie', oricine, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const proba = z
      .object({
        lungime: z.coerce.number().int().positive().optional(),
        latime: z.coerce.number().int().positive().optional(),
        inaltime: z.coerce.number().int().positive().optional(),
      })
      .parse(cerere.query)

    const context = await incarcaPentruComparatie(id)

    const coloane: { cod: string; laComanda: boolean }[] = context.dimensiuni.map((d) => ({
      cod: d.cod,
      laComanda: false,
    }))

    const dimensiuni: DimensiuneCeruta[] = context.dimensiuni.map((d) => ({
      id: d.id,
      cod: d.cod,
      lungime: d.lungime,
      latime: d.latime,
      inaltime: d.inaltime,
    }))

    // A trial size, so a formula can be pushed past the registered sizes before
    // anybody is asked to build one.
    if (proba.lungime !== undefined && proba.latime !== undefined) {
      const cod = `${proba.lungime}×${proba.latime}${
        proba.inaltime === undefined ? '' : `×${proba.inaltime}`
      }`
      coloane.push({ cod, laComanda: true })
      dimensiuni.push({
        id: null,
        cod,
        lungime: String(proba.lungime),
        latime: String(proba.latime),
        inaltime: proba.inaltime === undefined ? null : String(proba.inaltime),
      })
    }

    const peDimensiune = dimensiuni.map((d) => cantitatiPeLinie(context.reteta, d))

    const linii = context.reteta.linii.map((linie, index) => ({
      linieId: linie.id,
      nrLinie: linie.nrLinie,
      grup: linie.grup,
      um: linie.um,
      modCalcul: linie.modCalcul,
      formula: linie.formula,
      denumire: context.denumiri.get(linie.codSaga ?? '') ?? linie.categorieVariabila,
      valori: peDimensiune.map((coloana) => {
        const c = coloana[index]
        return { cantitate: c?.cantitate ?? null, motiv: c?.motiv ?? null }
      }),
    }))

    return { coloane, linii }
  })

  app.post('/modele/:id/dimensiuni', doarTehnolog, async (cerere, raspuns) => {
    const { id } = schemaId.parse(cerere.params)
    const date = schemaDimensiune.parse(cerere.body)

    const [parinte] = await db.select().from(model).where(eq(model.id, id)).limit(1)
    if (parinte === undefined) throw new NuExista('Modelul nu există.')

    if (date.codSagaProdus !== null && date.codSagaProdus !== undefined && date.codSagaProdus !== '') {
      const [articol] = await db
        .select({ tip: sagaArticle.tip })
        .from(sagaArticle)
        .where(eq(sagaArticle.codSaga, date.codSagaProdus))
        .limit(1)
      if (articol === undefined) {
        throw new CerereInvalida(`Codul ${date.codSagaProdus} nu există în nomenclator.`)
      }
      // Booking a finished product against a raw-material code would produce a
      // bon SAGA accepts and the accountant cannot explain.
      if (articol.tip !== 'produs') {
        throw new CerereInvalida(
          `Codul ${date.codSagaProdus} nu este produs finit în SAGA, ci ${articol.tip}.`,
        )
      }
    }

    try {
      const [creata] = await db
        .insert(dimension)
        .values({
          modelId: id,
          cod: date.cod,
          lungime: date.lungime,
          latime: date.latime,
          inaltime: date.inaltime ?? null,
          codSagaProdus: date.codSagaProdus === '' ? null : (date.codSagaProdus ?? null),
        })
        .returning()

      return raspuns.status(201).send(creata)
    } catch (err) {
      if (esteDuplicat(err)) {
        throw new Conflict(`Modelul are deja o dimensiune cu codul ${date.cod}.`)
      }
      throw err
    }
  })

  /**
   * The measurements of a dimension a bon was issued on are frozen.
   *
   * Recipes are versioned so that a bon means today what it meant when it was
   * issued; the dimension it was calculated against was not, and editing
   * 2000×1600 into 2100×1600 silently rewrote the meaning of every bon behind
   * it. The label and the SAGA code stay editable — they name the thing, they
   * are not inputs to the calculation.
   */
  app.patch('/modele/:id/dimensiuni/:dimensiuneId', doarTehnolog, async (cerere) => {
    const { id, dimensiuneId } = schemaIdDimensiune.parse(cerere.params)
    const date = schemaDimensiuneBaza.partial().extend({ activ: z.boolean().optional() }).parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const schimbaMasuri =
      date.lungime !== undefined || date.latime !== undefined || date.inaltime !== undefined

    if (schimbaMasuri) {
      const [cuBonuri] = await db
        .select({ n: count() })
        .from(productionOrder)
        .where(
          and(
            eq(productionOrder.dimensionId, dimensiuneId),
            ne(productionOrder.status, 'anulat'),
          ),
        )

      if ((cuBonuri?.n ?? 0) > 0) {
        throw new Conflict(
          `Dimensiunea are ${cuBonuri?.n} bonuri emise pe ea. Măsurile nu se mai schimbă — ` +
            'consumurile de pe bonuri s-au calculat din ele. Adaugă o dimensiune nouă.',
        )
      }
    }

    const [actualizata] = await db
      .update(dimension)
      .set({
        ...(date.cod !== undefined ? { cod: date.cod } : {}),
        ...(date.lungime !== undefined ? { lungime: date.lungime } : {}),
        ...(date.latime !== undefined ? { latime: date.latime } : {}),
        ...(date.inaltime !== undefined ? { inaltime: date.inaltime } : {}),
        ...(date.codSagaProdus !== undefined
          ? { codSagaProdus: date.codSagaProdus === '' ? null : date.codSagaProdus }
          : {}),
        ...(date.activ !== undefined ? { activ: date.activ } : {}),
      })
      .where(and(eq(dimension.id, dimensiuneId), eq(dimension.modelId, id)))
      .returning()

    if (actualizata === undefined) throw new NuExista('Dimensiunea nu există.')

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'dimension',
      entitateId: dimensiuneId,
      actiune: 'modificare',
      diff: date,
    })

    return actualizata
  })
}
