import {
  dimension,
  model,
  productionOrder,
  productionOrderLine,
  sagaArticle,
} from '@samobi/shared/db'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { autentifica, ceruRol, TOTI, type VerificatorToken } from '../auth.js'
import { db } from '../db.js'

/**
 * What production actually cost, and the honesty that requires.
 *
 * A price is the catalogue's weighted average where SAGA has one, and otherwise
 * the unit price the article last went out at on a production bon. Even so, a
 * good half of the lines a recipe touches carry no figure at all. The report
 * states how much of its own total is actually priced, because a cost that
 * silently ignores half the materials is worse than no cost — it looks like an
 * answer.
 */

const schemaPerioada = z.object({
  deLa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data are formatul AAAA-LL-ZZ.'),
  panaLa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data are formatul AAAA-LL-ZZ.'),
})

function bani(valoare: number): string {
  return valoare.toFixed(2)
}

export function ruteRapoarte(app: FastifyInstance, verifica: VerificatorToken) {
  const oricine = {
    preHandler: [autentifica(verifica), ceruRol(...TOTI)],
  }

  /** What was actually consumed, and what it cost, over a period. */
  app.get('/rapoarte/cost', oricine, async (cerere) => {
    const { deLa, panaLa } = schemaPerioada.parse(cerere.query)

    const linii = await db
      .select({
        modelCod: model.cod,
        modelDenumire: model.denumire,
        dimensiuneCod: dimension.cod,
        cantitateProdus: productionOrder.cantitate,
        bonId: productionOrder.id,
        codSaga: productionOrderLine.codSaga,
        cantitateNeta: productionOrderLine.cantitateNeta,
        cantitateBruta: productionOrderLine.cantitateBruta,
        pret: sql<string | null>`coalesce(${sagaArticle.pretReferinta}, ${sagaArticle.pretConsum})`,
      })
      .from(productionOrderLine)
      .innerJoin(productionOrder, eq(productionOrder.id, productionOrderLine.productionOrderId))
      .innerJoin(model, eq(model.id, productionOrder.modelId))
      .innerJoin(dimension, eq(dimension.id, productionOrder.dimensionId))
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, productionOrderLine.codSaga))
      .where(
        and(
          eq(productionOrder.status, 'exportat'),
          gte(productionOrder.data, deLa),
          lte(productionOrder.data, panaLa),
        ),
      )
      .orderBy(asc(model.cod))

    const peModel = new Map<
      string,
      { denumire: string; bonuri: Set<string>; bucati: number; net: number; pierderi: number; faraPret: number; linii: number }
    >()

    for (const l of linii) {
      const cheie = `${l.modelCod} · ${l.dimensiuneCod}`
      const o = peModel.get(cheie) ?? {
        denumire: l.modelDenumire,
        bonuri: new Set<string>(),
        bucati: 0,
        net: 0,
        pierderi: 0,
        faraPret: 0,
        linii: 0,
      }
      if (!o.bonuri.has(l.bonId)) {
        o.bonuri.add(l.bonId)
        o.bucati += Number(l.cantitateProdus)
      }
      o.linii += 1
      if (l.pret === null) o.faraPret += 1
      else {
        const pret = Number(l.pret)
        o.net += Number(l.cantitateNeta) * pret
        o.pierderi += (Number(l.cantitateBruta) - Number(l.cantitateNeta)) * pret
      }
      peModel.set(cheie, o)
    }

    const randuri = [...peModel.entries()]
      .map(([cheie, o]) => ({
        model: cheie,
        denumire: o.denumire,
        bonuri: o.bonuri.size,
        bucati: o.bucati,
        costNet: bani(o.net),
        costPierderi: bani(o.pierderi),
        costTotal: bani(o.net + o.pierderi),
        costPeBucata: o.bucati > 0 ? bani((o.net + o.pierderi) / o.bucati) : null,
        acoperire: o.linii === 0 ? 0 : Math.round(((o.linii - o.faraPret) / o.linii) * 100),
      }))
      .sort((a, b) => Number(b.costTotal) - Number(a.costTotal))

    return {
      deLa,
      panaLa,
      randuri,
      total: bani(randuri.reduce((s, r) => s + Number(r.costTotal), 0)),
      totalPierderi: bani(randuri.reduce((s, r) => s + Number(r.costPierderi), 0)),
    }
  })
}
