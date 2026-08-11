import { dimension, model, productionOrder, recipe, sagaArticle } from '@samobi/shared/db'
import { cantitatiPeLinie, type DimensiuneCeruta } from '@samobi/shared/calcul'
import {
  schemaDimensiune,
  schemaDimensiuneBaza,
  schemaModel,
  schemaModificareModel,
} from '@samobi/shared/scheme'
import { and, asc, count, eq, ne } from 'drizzle-orm'
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

    return { ...gasit, modificatLa: gasit.modificatLa.toISOString(), dimensiuni }
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

    // A trial size, so a formula can be pushed past the registered ones before
    // anybody adds a dimension for it.
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
