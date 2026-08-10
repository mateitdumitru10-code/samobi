import {
  dimension,
  exportBatch,
  model,
  productionOrder,
  productionOrderLine,
  sagaArticle,
} from '@samobi/shared/db'
import { EroareCalcul } from '@samobi/shared/calcul'
import { normalizeazaUm } from '@samobi/shared/nomenclator'
import { schemaBonNou, schemaExport, schemaPrevizualizare } from '@samobi/shared/scheme'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { scrieAudit } from '../audit.js'
import { autentifica, ceruRol, utilizatorul, type VerificatorToken } from '../auth.js'
import { calculeazaCuDenumiri, incarcaPentruCalcul } from '../bonuri/serviciu.js'
import { db } from '../db.js'
import { CerereInvalida, Conflict, NuExista } from '../erori.js'
import { hashContinut, scrieExport, type RandExport } from '../export/xlsx.js'
import { incarcaExport, linkSemnat } from '../export/stocare.js'

const schemaId = z.object({ id: z.string().uuid('Identificator invalid.') })

export function ruteBonuri(app: FastifyInstance, verifica: VerificatorToken) {
  const oricine = {
    preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog', 'operator', 'contabil')],
  }
  const poateEmite = {
    preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog', 'operator')],
  }
  const poateExporta = {
    preHandler: [autentifica(verifica), ceruRol('admin', 'contabil', 'operator')],
  }

  /** What a bon needs before it can be filled in: dimensions and variable lines. */
  app.get('/bonuri/context/:id', poateEmite, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const { dimensiuneId } = z
      .object({ dimensiuneId: z.string().uuid().optional() })
      .parse(cerere.query)

    const dimensiuni = await db
      .select()
      .from(dimension)
      .where(and(eq(dimension.modelId, id), eq(dimension.activ, true)))

    if (dimensiuneId === undefined) {
      return { dimensiuni, liniiVariabile: [] }
    }

    const context = await incarcaPentruCalcul(id, dimensiuneId)
    return { dimensiuni, liniiVariabile: context.liniiVariabile }
  })

  /**
   * Consumption for a bon that has not been saved yet.
   *
   * The operator sees the numbers before committing to them; the same pure
   * function produces what will later be stored.
   */
  app.post('/bonuri/previzualizare', poateEmite, async (cerere) => {
    const date = schemaPrevizualizare.parse(cerere.body)
    try {
      const { linii, avertismenteUm } = await calculeazaCuDenumiri(date)
      return { linii, avertismenteUm }
    } catch (err) {
      if (err instanceof EroareCalcul) throw new CerereInvalida(err.message)
      throw err
    }
  })

  app.post('/bonuri', poateEmite, async (cerere, raspuns) => {
    const date = schemaBonNou.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const [dim] = await db
      .select()
      .from(dimension)
      .where(and(eq(dimension.id, date.dimensiuneId), eq(dimension.modelId, date.modelId)))
      .limit(1)

    if (dim === undefined) throw new NuExista('Dimensiunea nu aparține modelului ales.')
    if (dim.codSagaProdus === null) {
      throw new CerereInvalida(
        `Dimensiunea ${dim.cod} nu are cod de produs finit în SAGA. Leagă-l înainte de a emite bonul.`,
      )
    }

    let calcul
    try {
      calcul = await calculeazaCuDenumiri(date)
    } catch (err) {
      if (err instanceof EroareCalcul) throw new CerereInvalida(err.message)
      throw err
    }

    const bon = await db.transaction(async (tx) => {
      const [creat] = await tx
        .insert(productionOrder)
        .values({
          nrDoc: date.nrDoc ?? null,
          data: date.data,
          gestiuneProdus: date.gestiuneProdus,
          modelId: date.modelId,
          dimensionId: date.dimensiuneId,
          // The recipe version, not the model. A bon from July stays
          // reproducible after the recipe changes in August.
          recipeId: calcul.context.reteta.id,
          codSagaProdus: dim.codSagaProdus ?? '',
          cantitate: date.cantitate,
          status: 'calculat',
          creatDe: utilizator.id,
        })
        .returning()

      const bonId = creat?.id
      if (bonId === undefined) throw new Error('Bonul nu a putut fi creat.')

      await tx.insert(productionOrderLine).values(
        calcul.linii.map((linie) => ({
          productionOrderId: bonId,
          codSaga: linie.codSaga,
          um: linie.um,
          cantitateNeta: linie.cantitateNeta,
          cantitateBruta: linie.cantitateBruta,
          sursa: linie.sursa,
          formulaEvaluata:
            linie.contributii.map((c) => c.formulaEvaluata).find((f) => f !== null) ?? null,
          gestiuneDescarcare: linie.gestiuneDescarcare,
        })),
      )

      return creat
    })

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'production_order',
      entitateId: bon?.id ?? '',
      actiune: 'creare',
      diff: { model: date.modelId, dimensiune: dim.cod, cantitate: date.cantitate },
    })

    return raspuns
      .status(201)
      .send({ ...bon, linii: calcul.linii, avertismenteUm: calcul.avertismenteUm })
  })

  app.get('/bonuri', oricine, async (cerere) => {
    const { status } = z
      .object({ status: z.enum(['draft', 'calculat', 'exportat', 'anulat']).optional() })
      .parse(cerere.query)

    const randuri = await db
      .select({
        id: productionOrder.id,
        nrDoc: productionOrder.nrDoc,
        data: productionOrder.data,
        cantitate: productionOrder.cantitate,
        status: productionOrder.status,
        gestiuneProdus: productionOrder.gestiuneProdus,
        codSagaProdus: productionOrder.codSagaProdus,
        exportId: productionOrder.exportId,
        creatLa: productionOrder.creatLa,
        modelCod: model.cod,
        modelDenumire: model.denumire,
        dimensiuneCod: dimension.cod,
        denumireProdus: sagaArticle.denumire,
      })
      .from(productionOrder)
      .innerJoin(model, eq(model.id, productionOrder.modelId))
      .innerJoin(dimension, eq(dimension.id, productionOrder.dimensionId))
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, productionOrder.codSagaProdus))
      .where(status === undefined ? undefined : eq(productionOrder.status, status))
      .orderBy(desc(productionOrder.creatLa))
      .limit(200)

    return randuri.map((r) => ({ ...r, creatLa: r.creatLa.toISOString() }))
  })

  app.get('/bonuri/:id', oricine, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)

    const [bon] = await db.select().from(productionOrder).where(eq(productionOrder.id, id)).limit(1)
    if (bon === undefined) throw new NuExista('Bonul nu există.')

    const linii = await db
      .select({
        codSaga: productionOrderLine.codSaga,
        um: productionOrderLine.um,
        cantitateNeta: productionOrderLine.cantitateNeta,
        cantitateBruta: productionOrderLine.cantitateBruta,
        sursa: productionOrderLine.sursa,
        formulaEvaluata: productionOrderLine.formulaEvaluata,
        gestiuneDescarcare: productionOrderLine.gestiuneDescarcare,
        denumire: sagaArticle.denumire,
      })
      .from(productionOrderLine)
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, productionOrderLine.codSaga))
      .where(eq(productionOrderLine.productionOrderId, id))

    return { ...bon, creatLa: bon.creatLa.toISOString(), linii }
  })

  /**
   * Generates the XLSX for a batch of bons and marks them exported.
   *
   * One row per material, aggregated across the batch — that is what SAGA's
   * `Producție` screen expects. The file lands in a private bucket; the response
   * carries a short-lived signed link, never the bytes.
   */
  app.post('/export', poateExporta, async (cerere) => {
    const { bonIds, confirmaReexport, confirmaUmDiferita } = schemaExport.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const bonuri = await db
      .select()
      .from(productionOrder)
      .where(inArray(productionOrder.id, bonIds))

    if (bonuri.length !== bonIds.length) throw new NuExista('Unul dintre bonuri nu există.')

    const anulate = bonuri.filter((b) => b.status === 'anulat')
    if (anulate.length > 0) throw new CerereInvalida('Un bon anulat nu se exportă.')

    const dejaExportate = bonuri.filter((b) => b.status === 'exportat')
    if (dejaExportate.length > 0 && !confirmaReexport) {
      throw new Conflict(
        `${dejaExportate.length} din bonurile alese au fost deja exportate. ` +
          'Reexportul le trimite a doua oară în SAGA — confirmă explicit dacă chiar asta vrei.',
      )
    }

    const linii = await db
      .select({
        codSaga: productionOrderLine.codSaga,
        um: productionOrderLine.um,
        cantitateBruta: productionOrderLine.cantitateBruta,
        denumire: sagaArticle.denumire,
        umSaga: sagaArticle.um,
      })
      .from(productionOrderLine)
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, productionOrderLine.codSaga))
      .where(inArray(productionOrderLine.productionOrderId, bonIds))

    if (linii.length === 0) throw new CerereInvalida('Bonurile alese nu au linii de consum.')

    // The last gate before accounting. A unit that differs by a factor of a
    // thousand produces a booking that looks entirely plausible, so it is
    // refused here rather than discovered in a stock count months later.
    const umGresite = linii.filter((l) => {
      const a = (normalizeazaUm(l.um) ?? '').toUpperCase()
      const b = (normalizeazaUm(l.umSaga ?? '') ?? '').toUpperCase()
      return a !== '' && b !== '' && a !== b
    })

    if (umGresite.length > 0 && !confirmaUmDiferita) {
      const exemple = [...new Set(umGresite.map((l) => `${l.codSaga} ${l.denumire ?? ''} (bon ${l.um} / SAGA ${l.umSaga})`))]
      throw new Conflict(
        `${umGresite.length} linii au altă unitate de măsură decât articolul din SAGA. ` +
          `Importate așa, cantitățile se înregistrează greșit — la capse și piulițe, de 1000 ` +
          `respectiv 100 de ori. Corectează UM în SAGA (vezi docs/um-de-corectat-in-saga.xlsx) ` +
          `sau confirmă explicit. Exemple: ${exemple.slice(0, 5).join('; ')}`,
      )
    }

    // Aggregate across bons, then round once, at the end.
    const cumulat = new Map<string, { denumire: string; um: string; total: number }>()
    for (const linie of linii) {
      const existent = cumulat.get(linie.codSaga)
      const valoare = Number(linie.cantitateBruta)
      if (existent === undefined) {
        cumulat.set(linie.codSaga, {
          denumire: linie.denumire ?? linie.codSaga,
          um: linie.um,
          total: valoare,
        })
      } else {
        existent.total += valoare
      }
    }

    const randuri: RandExport[] = [...cumulat.entries()]
      .map(([codSaga, v]) => ({
        codSaga,
        denumire: v.denumire,
        um: v.um,
        cantitate: v.total.toFixed(3),
      }))
      .sort((a, b) => a.codSaga.localeCompare(b.codSaga))

    const continut = await scrieExport(randuri)
    const hash = hashContinut(randuri)

    const stampila = new Date().toISOString().replace(/[:.]/g, '-')
    const cale = `${stampila}-${hash.slice(0, 8)}.xlsx`

    await incarcaExport(cale, continut)

    const lot = await db.transaction(async (tx) => {
      const [creat] = await tx
        .insert(exportBatch)
        .values({
          generatDe: utilizator.id,
          hashContinut: hash,
          nrBonuri: bonuri.length,
          nrLinii: randuri.length,
          storagePath: cale,
        })
        .returning()

      const lotId = creat?.id
      if (lotId === undefined) throw new Error('Lotul de export nu a putut fi creat.')

      await tx
        .update(productionOrder)
        .set({ status: 'exportat', exportId: lotId })
        .where(inArray(productionOrder.id, bonIds))

      return creat
    })

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'export_batch',
      entitateId: lot?.id ?? '',
      actiune: 'creare',
      diff: { nrBonuri: bonuri.length, nrLinii: randuri.length, hash, reexport: confirmaReexport },
    })

    return {
      id: lot?.id ?? '',
      nrBonuri: bonuri.length,
      nrLinii: randuri.length,
      hashContinut: hash,
      randuri,
    }
  })

  app.get('/export', oricine, async () => {
    const randuri = await db
      .select({
        id: exportBatch.id,
        generatLa: exportBatch.generatLa,
        nrBonuri: exportBatch.nrBonuri,
        nrLinii: exportBatch.nrLinii,
        hashContinut: exportBatch.hashContinut,
        storagePath: exportBatch.storagePath,
      })
      .from(exportBatch)
      .orderBy(desc(exportBatch.generatLa))
      .limit(50)

    return randuri.map((r) => ({ ...r, generatLa: r.generatLa.toISOString() }))
  })

  /** A signed link, issued only after the role check. The bucket stays private. */
  app.get('/export/:id/descarcare', poateExporta, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)

    const [lot] = await db.select().from(exportBatch).where(eq(exportBatch.id, id)).limit(1)
    if (lot === undefined || lot.storagePath === null) throw new NuExista('Exportul nu există.')

    const url = await linkSemnat(lot.storagePath, `consumuri-${lot.hashContinut.slice(0, 8)}.xlsx`)
    return { url }
  })

  /** Cancelling is a status change; bons are never deleted. */
  app.post('/bonuri/:id/anulare', poateEmite, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const utilizator = utilizatorul(cerere)

    const [bon] = await db.select().from(productionOrder).where(eq(productionOrder.id, id)).limit(1)
    if (bon === undefined) throw new NuExista('Bonul nu există.')
    if (bon.status === 'exportat') {
      throw new Conflict('Bonul a fost deja exportat în SAGA. Corectează acolo, nu aici.')
    }

    await db
      .update(productionOrder)
      .set({ status: 'anulat', exportId: sql`null` })
      .where(eq(productionOrder.id, id))

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'production_order',
      entitateId: id,
      actiune: 'dezactivare',
    })

    return { id, status: 'anulat' }
  })
}
