import {
  dimension,
  model,
  productionOrder,
  productionOrderLine,
  recipeLine,
  sagaArticle,
} from '@samobi/shared/db'
import { EroareCalcul } from '@samobi/shared/calcul'
import { normalizeazaUm } from '@samobi/shared/nomenclator'
import { schemaPrevizualizare } from '@samobi/shared/scheme'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { autentifica, ceruRol, type VerificatorToken } from '../auth.js'
import { calculeazaCuDenumiri } from '../bonuri/serviciu.js'
import { db } from '../db.js'
import { CerereInvalida } from '../erori.js'

/**
 * Reports, and the honesty they require.
 *
 * A price is the catalogue's weighted average where SAGA has one, and otherwise
 * the unit price the article last went out at on a production bon. Even so, a
 * good half of the lines a recipe touches carry no figure at all. Every report
 * here states how much of its own total is actually priced, because a cost that
 * silently ignores half the materials is worse than no cost — it looks like an
 * answer.
 */

const schemaPerioada = z.object({
  deLa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data are formatul AAAA-LL-ZZ.'),
  panaLa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data are formatul AAAA-LL-ZZ.'),
})

interface RandCost {
  codSaga: string
  denumire: string
  um: string
  grup: string | null
  cantitateNeta: string
  cantitateBruta: string
  pretUnitar: string | null
  valoareNeta: string | null
  /** What the waste percentage costs, kept apart from the material itself. */
  valoarePierderi: string | null
  valoareTotala: string | null
}

function bani(valoare: number): string {
  return valoare.toFixed(2)
}

export function ruteRapoarte(app: FastifyInstance, verifica: VerificatorToken) {
  const oricine = {
    preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog', 'operator', 'contabil')],
  }

  /**
   * What one production run should cost, before it happens.
   *
   * Net and waste are reported separately because they are different decisions:
   * one is the design, the other is how well the cutting goes.
   */
  app.post('/rapoarte/antecalculatie', oricine, async (cerere) => {
    const date = schemaPrevizualizare.parse(cerere.body)

    let calcul
    try {
      calcul = await calculeazaCuDenumiri({
        modelId: date.modelId,
        // Quoting a made-to-order size is the reason somebody opens this report.
        dimensiune:
          date.dimensiuneId !== undefined
            ? { dimensiuneId: date.dimensiuneId }
            : {
                lungime: date.dimensiune?.lungime ?? '',
                latime: date.dimensiune?.latime ?? '',
                inaltime: date.dimensiune?.inaltime ?? null,
              },
        cantitate: date.cantitate,
        alegeri: date.alegeri,
        valoriManuale: date.valoriManuale,
      })
    } catch (err) {
      if (err instanceof EroareCalcul) throw new CerereInvalida(err.message)
      throw err
    }

    const coduri = calcul.linii.map((l) => l.codSaga)
    const articole =
      coduri.length === 0
        ? []
        : await db
            .select({
              codSaga: sagaArticle.codSaga,
              // The average if the catalogue has one, otherwise the last price
              // the article was actually consumed at.
              pretReferinta: sql<string | null>`coalesce(${sagaArticle.pretReferinta}, ${sagaArticle.pretConsum})`,
              um: sagaArticle.um,
            })
            .from(sagaArticle)
            .where(inArray(sagaArticle.codSaga, coduri))

    /**
     * A price only counts when it is quoted in the unit the recipe uses.
     *
     * The catalogue holds PAL per plate and the sheet consumes square metres;
     * multiplying one by the other produces a number with no meaning. Those
     * lines are reported as unpriced rather than silently wrong.
     */
    const preturi = new Map(
      articole.map((a) => [
        a.codSaga,
        { pret: a.pretReferinta, um: (normalizeazaUm(a.um) ?? '').toUpperCase() },
      ]),
    )

    // The recipe's group, so the cost can be read the way the recipe is written.
    const grupuri = new Map(
      (
        await db
          .select({ codSaga: recipeLine.codSaga, grup: recipeLine.grup })
          .from(recipeLine)
          .where(eq(recipeLine.recipeId, calcul.context.reteta.id))
      ).map((l) => [l.codSaga ?? '', l.grup]),
    )

    let totalNet = 0
    let totalPierderi = 0
    let faraPret = 0

    let umNepotrivita = 0

    const randuri: RandCost[] = calcul.linii.map((linie) => {
      const articol = preturi.get(linie.codSaga)
      const umLinie = (normalizeazaUm(linie.um) ?? '').toUpperCase()
      const potrivit =
        articol !== undefined && articol.um !== '' && umLinie !== '' && articol.um === umLinie

      if (articol?.pret == null) faraPret += 1
      else if (!potrivit) umNepotrivita += 1

      const unitar = articol?.pret != null && potrivit ? Number(articol.pret) : null
      const net = unitar === null ? null : Number(linie.cantitateNeta) * unitar
      const brut = unitar === null ? null : Number(linie.cantitateBruta) * unitar

      if (net !== null) totalNet += net
      if (brut !== null && net !== null) totalPierderi += brut - net

      return {
        codSaga: linie.codSaga,
        denumire: linie.denumire,
        um: linie.um,
        grup: grupuri.get(linie.codSaga) ?? null,
        cantitateNeta: linie.cantitateNeta,
        cantitateBruta: linie.cantitateBruta,
        pretUnitar: unitar === null ? null : bani(unitar),
        valoareNeta: net === null ? null : bani(net),
        valoarePierderi: net === null || brut === null ? null : bani(brut - net),
        valoareTotala: brut === null ? null : bani(brut),
      }
    })

    const peGrup = new Map<string, number>()
    for (const r of randuri) {
      if (r.valoareTotala === null) continue
      const cheie = r.grup ?? 'NEÎNCADRAT'
      peGrup.set(cheie, (peGrup.get(cheie) ?? 0) + Number(r.valoareTotala))
    }

    const cantitate = Number(date.cantitate)

    return {
      model: calcul.context.reteta.modelId,
      versiuneReteta: calcul.context.reteta.versiune,
      cantitate: date.cantitate,
      randuri,
      peGrup: [...peGrup.entries()]
        .map(([grup, valoare]) => ({ grup, valoare: bani(valoare) }))
        .sort((a, b) => Number(b.valoare) - Number(a.valoare)),
      total: {
        net: bani(totalNet),
        pierderi: bani(totalPierderi),
        total: bani(totalNet + totalPierderi),
        peBucata: cantitate > 0 ? bani((totalNet + totalPierderi) / cantitate) : null,
      },
      // Stated, not buried: a cost that ignores a third of the lines is not a cost.
      acoperire: {
        linii: randuri.length,
        faraPret,
        // Priced, but in a unit the quantity is not expressed in. Counted apart
        // so the gap is attributable rather than lumped in with "no price".
        umNepotrivita,
        procent:
          randuri.length === 0
            ? 0
            : Math.round(((randuri.length - faraPret - umNepotrivita) / randuri.length) * 100),
      },
    }
  })

  /**
   * What still has to be bought for the bons that have not gone to SAGA yet.
   *
   * Stock is a snapshot from the last import that carried it, and the response
   * says so rather than implying a live figure.
   */
  app.get('/rapoarte/necesar', oricine, async (cerere) => {
    const { status } = z
      .object({ status: z.enum(['calculat', 'draft']).default('calculat') })
      .parse(cerere.query)

    const linii = await db
      .select({
        codSaga: productionOrderLine.codSaga,
        um: productionOrderLine.um,
        cantitateBruta: productionOrderLine.cantitateBruta,
        denumire: sagaArticle.denumire,
        stoc: sagaArticle.stoc,
        pret: sql<string | null>`coalesce(${sagaArticle.pretReferinta}, ${sagaArticle.pretConsum})`,
        gestiune: sagaArticle.gestiuneImplicita,
      })
      .from(productionOrderLine)
      .innerJoin(productionOrder, eq(productionOrder.id, productionOrderLine.productionOrderId))
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, productionOrderLine.codSaga))
      .where(eq(productionOrder.status, status))

    const cumulat = new Map<
      string,
      { denumire: string; um: string; necesar: number; stoc: number | null; pret: number | null; gestiune: string | null }
    >()

    for (const l of linii) {
      const existent = cumulat.get(l.codSaga)
      const cantitate = Number(l.cantitateBruta)
      if (existent === undefined) {
        cumulat.set(l.codSaga, {
          denumire: l.denumire ?? l.codSaga,
          um: l.um,
          necesar: cantitate,
          stoc: l.stoc === null ? null : Number(l.stoc),
          pret: l.pret === null ? null : Number(l.pret),
          gestiune: l.gestiune,
        })
      } else {
        existent.necesar += cantitate
      }
    }

    let valoareDeCumparat = 0

    const randuri = [...cumulat.entries()]
      .map(([codSaga, v]) => {
        const lipsa = v.stoc === null ? v.necesar : Math.max(0, v.necesar - v.stoc)
        if (v.pret !== null) valoareDeCumparat += lipsa * v.pret
        return {
          codSaga,
          denumire: v.denumire,
          um: v.um,
          gestiune: v.gestiune,
          necesar: v.necesar.toFixed(3),
          stoc: v.stoc === null ? null : v.stoc.toFixed(3),
          lipsa: lipsa.toFixed(3),
          pretUnitar: v.pret === null ? null : bani(v.pret),
          valoare: v.pret === null ? null : bani(lipsa * v.pret),
        }
      })
      .filter((r) => Number(r.lipsa) > 0)
      .sort((a, b) => Number(b.valoare ?? 0) - Number(a.valoare ?? 0) || a.denumire.localeCompare(b.denumire))

    const [ultimulImport] = await db
      .select({ sincronizatLa: sagaArticle.sincronizatLa })
      .from(sagaArticle)
      .orderBy(sql`${sagaArticle.sincronizatLa} desc nulls last`)
      .limit(1)

    return {
      status,
      randuri,
      total: bani(valoareDeCumparat),
      faraPret: randuri.filter((r) => r.pretUnitar === null).length,
      faraStoc: randuri.filter((r) => r.stoc === null).length,
      stocLa: ultimulImport?.sincronizatLa?.toISOString() ?? null,
    }
  })

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
      // Left, not inner: a made-to-order bon has no dimension row, and an inner
      // join would drop exactly the bons somebody opened this report to see.
      .leftJoin(dimension, eq(dimension.id, productionOrder.dimensionId))
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
      // Every made-to-order size would otherwise be its own group of one, and
      // cost-per-piece across the model would dissolve into noise.
      const cheie = `${l.modelCod} · ${l.dimensiuneCod ?? 'la comandă'}`
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
