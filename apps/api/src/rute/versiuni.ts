import {
  productionOrder,
  recipe,
  recipeLine,
  recipeLineDimension,
  sagaArticle,
} from '@samobi/shared/db'
import {
  schemaAprobare,
  schemaRespingere,
  type FelSchimbare,
  type SchimbareLinie,
} from '@samobi/shared/scheme'
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { scrieAudit } from '../audit.js'
import { autentifica, ceruRol, utilizatorul, type VerificatorToken } from '../auth.js'
import { db } from '../db.js'
import { CerereInvalida, Conflict, NuExista } from '../erori.js'

const schemaId = z.object({ id: z.string().uuid('Identificator invalid.') })
const schemaIdModel = z.object({ modelId: z.string().uuid('Identificator invalid.') })

/**
 * The recipe lifecycle.
 *
 *   draft → in_aprobare → activa → arhivata
 *
 * An active recipe is never edited. Changing it means a new draft version, which
 * goes through approval and displaces the previous active one. Bons keep
 * pointing at the version they were calculated with, so a bon from July stays
 * reproducible after August's change — which is the whole reason versions exist
 * rather than a single mutable recipe.
 */
export function ruteVersiuni(app: FastifyInstance, verifica: VerificatorToken) {
  const oricine = {
    preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog', 'operator', 'contabil')],
  }
  const doarTehnolog = { preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog')] }
  const doarAdmin = { preHandler: [autentifica(verifica), ceruRol('admin')] }

  app.get('/modele/:modelId/versiuni', oricine, async (cerere) => {
    const { modelId } = schemaIdModel.parse(cerere.params)

    const versiuni = await db
      .select()
      .from(recipe)
      .where(eq(recipe.modelId, modelId))
      .orderBy(desc(recipe.versiune))

    if (versiuni.length === 0) return []

    const ids = versiuni.map((v) => v.id)

    const liniiPerVersiune = await db
      .select({ recipeId: recipeLine.recipeId, n: count() })
      .from(recipeLine)
      .where(inArray(recipeLine.recipeId, ids))
      .groupBy(recipeLine.recipeId)

    const bonuriPerVersiune = await db
      .select({ recipeId: productionOrder.recipeId, n: count() })
      .from(productionOrder)
      .where(inArray(productionOrder.recipeId, ids))
      .groupBy(productionOrder.recipeId)

    const linii = new Map(liniiPerVersiune.map((l) => [l.recipeId, l.n]))
    const bonuri = new Map(bonuriPerVersiune.map((b) => [b.recipeId, b.n]))

    return versiuni.map((v) => ({
      id: v.id,
      versiune: v.versiune,
      status: v.status,
      valabilDeLa: v.valabilDeLa,
      aprobatDe: v.aprobatDe,
      aprobatLa: v.aprobatLa?.toISOString() ?? null,
      creatLa: v.creatLa.toISOString(),
      nrLinii: linii.get(v.id) ?? 0,
      // Bons pin a version. A version with bons against it can never be edited.
      nrBonuri: bonuri.get(v.id) ?? 0,
    }))
  })

  /**
   * Copies the current recipe into a fresh draft.
   *
   * The copy is what gets edited; the active version stays exactly as the bons
   * issued against it remember it.
   */
  app.post('/modele/:modelId/versiuni', doarTehnolog, async (cerere, raspuns) => {
    const { modelId } = schemaIdModel.parse(cerere.params)
    const utilizator = utilizatorul(cerere)

    const creata = await db.transaction(async (tx) => {
      const [ultima] = await tx
        .select()
        .from(recipe)
        .where(eq(recipe.modelId, modelId))
        .orderBy(desc(recipe.versiune))
        .limit(1)

      if (ultima === undefined) throw new NuExista('Modelul nu are nicio rețetă.')
      if (ultima.status === 'draft') {
        throw new Conflict(
          `Versiunea ${ultima.versiune} este deja în lucru. Modific-o pe aceea, nu crea alta.`,
        )
      }
      if (ultima.status === 'in_aprobare') {
        throw new Conflict(
          `Versiunea ${ultima.versiune} așteaptă aprobare. Așteaptă răspunsul sau retrage-o.`,
        )
      }

      const [noua] = await tx
        .insert(recipe)
        .values({
          modelId,
          versiune: ultima.versiune + 1,
          status: 'draft',
          creatDe: utilizator.id,
        })
        .returning()

      if (noua === undefined) throw new Error('Versiunea nu a putut fi creată.')

      const liniiVechi = await tx
        .select()
        .from(recipeLine)
        .where(eq(recipeLine.recipeId, ultima.id))
        .orderBy(asc(recipeLine.nrLinie))

      if (liniiVechi.length > 0) {
        const inserate = await tx
          .insert(recipeLine)
          .values(
            liniiVechi.map((l) => ({
              recipeId: noua.id,
              nrLinie: l.nrLinie,
              grup: l.grup,
              codSaga: l.codSaga,
              esteVariabil: l.esteVariabil,
              categorieVariabila: l.categorieVariabila,
              um: l.um,
              modCalcul: l.modCalcul,
              cantitateFixa: l.cantitateFixa,
              formula: l.formula,
              procentPierderi: l.procentPierderi,
              gestiuneDescarcare: l.gestiuneDescarcare,
              obligatoriu: l.obligatoriu,
              observatii: l.observatii,
            })),
          )
          .returning({ id: recipeLine.id, nrLinie: recipeLine.nrLinie })

        const noulId = new Map(inserate.map((i) => [i.nrLinie, i.id]))
        const valori = await db
          .select()
          .from(recipeLineDimension)
          .where(
            inArray(
              recipeLineDimension.recipeLineId,
              liniiVechi.map((l) => l.id),
            ),
          )
        const vechiPeId = new Map(liniiVechi.map((l) => [l.id, l.nrLinie]))

        // Table quantities and overrides travel with the line, reason and all.
        const deCopiat = valori
          .map((v) => ({ v, nrLinie: vechiPeId.get(v.recipeLineId) }))
          .filter((x): x is { v: (typeof valori)[number]; nrLinie: number } => x.nrLinie !== undefined)

        if (deCopiat.length > 0) {
          await tx.insert(recipeLineDimension).values(
            deCopiat.map(({ v, nrLinie }) => ({
              recipeLineId: noulId.get(nrLinie) ?? '',
              dimensionId: v.dimensionId,
              cantitate: v.cantitate,
              esteOverride: v.esteOverride,
              motiv: v.motiv,
              setatDe: v.setatDe,
              setatLa: v.setatLa,
            })),
          )
        }
      }

      return { ...noua, copiateDin: ultima.versiune, nrLinii: liniiVechi.length }
    })

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'recipe',
      entitateId: creata.id,
      actiune: 'creare',
      diff: { versiune: creata.versiune, copiateDin: creata.copiateDin },
    })

    return raspuns.status(201).send(creata)
  })

  app.post('/retete/:id/trimite-spre-aprobare', doarTehnolog, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const utilizator = utilizatorul(cerere)

    const [reteta] = await db.select().from(recipe).where(eq(recipe.id, id)).limit(1)
    if (reteta === undefined) throw new NuExista('Rețeta nu există.')
    if (reteta.status !== 'draft') {
      throw new Conflict(`Doar o rețetă în lucru se trimite spre aprobare, nu una ${reteta.status}.`)
    }

    const [nrLinii] = await db
      .select({ n: count() })
      .from(recipeLine)
      .where(eq(recipeLine.recipeId, id))
    if ((nrLinii?.n ?? 0) === 0) {
      throw new CerereInvalida('O rețetă fără linii nu se aprobă.')
    }

    await db.update(recipe).set({ status: 'in_aprobare' }).where(eq(recipe.id, id))

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'recipe',
      entitateId: id,
      actiune: 'modificare',
      diff: { status: 'in_aprobare', nrLinii: nrLinii?.n ?? 0 },
    })

    return { id, status: 'in_aprobare' }
  })

  /**
   * Approval, which is also the moment the previous active version retires.
   *
   * Both happen in one transaction because `one_active_recipe_per_model` will
   * not tolerate the in-between state, and rightly so: two active recipes make
   * every bon ambiguous.
   */
  app.post('/retete/:id/aprobare', doarAdmin, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const { valabilDeLa } = schemaAprobare.parse(cerere.body ?? {})
    const utilizator = utilizatorul(cerere)

    const rezultat = await db.transaction(async (tx) => {
      const [reteta] = await tx.select().from(recipe).where(eq(recipe.id, id)).limit(1)
      if (reteta === undefined) throw new NuExista('Rețeta nu există.')
      if (reteta.status !== 'in_aprobare') {
        throw new Conflict(
          `Se aprobă doar ce a fost trimis spre aprobare. Rețeta este ${reteta.status}.`,
        )
      }
      // Also enforced by a CHECK; caught here to say it in Romanian.
      if (reteta.creatDe === utilizator.id) {
        throw new Conflict('Nu îți poți aproba propria rețetă. O aprobă alt administrator.')
      }

      const arhivate = await tx
        .update(recipe)
        .set({ status: 'arhivata' })
        .where(and(eq(recipe.modelId, reteta.modelId), eq(recipe.status, 'activa'), ne(recipe.id, id)))
        .returning({ versiune: recipe.versiune })

      await tx
        .update(recipe)
        .set({
          status: 'activa',
          aprobatDe: utilizator.id,
          aprobatLa: new Date(),
          valabilDeLa: valabilDeLa ?? new Date().toISOString().slice(0, 10),
        })
        .where(eq(recipe.id, id))

      return { versiune: reteta.versiune, arhivate: arhivate.map((a) => a.versiune) }
    })

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'recipe',
      entitateId: id,
      actiune: 'modificare',
      diff: { status: 'activa', ...rezultat },
    })

    return { id, status: 'activa', ...rezultat }
  })

  app.post('/retete/:id/respingere', doarAdmin, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const { motiv } = schemaRespingere.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const [reteta] = await db.select().from(recipe).where(eq(recipe.id, id)).limit(1)
    if (reteta === undefined) throw new NuExista('Rețeta nu există.')
    if (reteta.status !== 'in_aprobare') {
      throw new Conflict(`Se respinge doar ce așteaptă aprobare. Rețeta este ${reteta.status}.`)
    }

    await db.update(recipe).set({ status: 'draft' }).where(eq(recipe.id, id))

    // The reason lives in the audit trail, which cannot be rewritten.
    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'recipe',
      entitateId: id,
      actiune: 'modificare',
      diff: { status: 'draft', respinsa: true, motiv },
    })

    return { id, status: 'draft', motiv }
  })

  /** Withdrawing a submission, so a tehnolog is not stuck waiting on an admin. */
  app.post('/retete/:id/retragere', doarTehnolog, async (cerere) => {
    const { id } = schemaId.parse(cerere.params)
    const utilizator = utilizatorul(cerere)

    const [reteta] = await db.select().from(recipe).where(eq(recipe.id, id)).limit(1)
    if (reteta === undefined) throw new NuExista('Rețeta nu există.')
    if (reteta.status !== 'in_aprobare') {
      throw new Conflict('Se retrage doar o rețetă trimisă spre aprobare.')
    }

    await db.update(recipe).set({ status: 'draft' }).where(eq(recipe.id, id))

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'recipe',
      entitateId: id,
      actiune: 'modificare',
      diff: { status: 'draft', retrasa: true },
    })

    return { id, status: 'draft' }
  })

  /**
   * What changed between two versions.
   *
   * Lines are paired by their number, which is the sheet's own numbering, so a
   * line that kept its position but changed article or quantity reads as a
   * modification rather than as a deletion and an unrelated addition.
   */
  app.get('/retete/:id/comparatie/:fataDe', oricine, async (cerere) => {
    const { id, fataDe } = z
      .object({ id: z.string().uuid(), fataDe: z.string().uuid() })
      .parse(cerere.params)

    const capete = await db.select().from(recipe).where(inArray(recipe.id, [id, fataDe]))
    if (capete.length !== 2) throw new NuExista('Una dintre versiuni nu există.')

    const [noua, veche] = [capete.find((c) => c.id === id), capete.find((c) => c.id === fataDe)]
    if (noua === undefined || veche === undefined) throw new NuExista('Versiune lipsă.')
    if (noua.modelId !== veche.modelId) {
      throw new CerereInvalida('Cele două versiuni nu aparțin aceluiași model.')
    }

    const linii = await db
      .select({
        recipeId: recipeLine.recipeId,
        nrLinie: recipeLine.nrLinie,
        codSaga: recipeLine.codSaga,
        esteVariabil: recipeLine.esteVariabil,
        um: recipeLine.um,
        modCalcul: recipeLine.modCalcul,
        cantitateFixa: recipeLine.cantitateFixa,
        formula: recipeLine.formula,
        procentPierderi: recipeLine.procentPierderi,
        denumire: sagaArticle.denumire,
      })
      .from(recipeLine)
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, recipeLine.codSaga))
      .where(inArray(recipeLine.recipeId, [id, fataDe]))

    const peVersiune = (rid: string) => new Map(linii.filter((l) => l.recipeId === rid).map((l) => [l.nrLinie, l]))
    const vechi = peVersiune(fataDe)
    const nou = peVersiune(id)

    const numere = [...new Set([...vechi.keys(), ...nou.keys()])].sort((a, b) => a - b)
    const schimbari: SchimbareLinie[] = []

    for (const nr of numere) {
      const a = vechi.get(nr)
      const b = nou.get(nr)

      let fel: FelSchimbare = 'neschimbat'
      const campuri: SchimbareLinie['campuri'] = []

      if (a === undefined) fel = 'adaugat'
      else if (b === undefined) fel = 'sters'
      else {
        const compara = (camp: string, x: string | null, y: string | null) => {
          const egal = camp === 'cantitateFixa' || camp === 'procentPierderi'
            ? Number(x ?? 0) === Number(y ?? 0)
            : (x ?? '') === (y ?? '')
          if (!egal) campuri.push({ camp, inainte: x, dupa: y })
        }
        compara('codSaga', a.codSaga, b.codSaga)
        compara('um', a.um, b.um)
        compara('modCalcul', a.modCalcul, b.modCalcul)
        compara('cantitateFixa', a.cantitateFixa, b.cantitateFixa)
        compara('formula', a.formula, b.formula)
        compara('procentPierderi', a.procentPierderi, b.procentPierderi)
        if (campuri.length > 0) fel = 'modificat'
      }

      schimbari.push({
        fel,
        nrLinie: nr,
        codSaga: (b ?? a)?.codSaga ?? null,
        denumire: (b ?? a)?.denumire ?? null,
        campuri,
      })
    }

    return {
      veche: { id: veche.id, versiune: veche.versiune, status: veche.status },
      noua: { id: noua.id, versiune: noua.versiune, status: noua.status },
      schimbari,
      rezumat: {
        adaugate: schimbari.filter((s) => s.fel === 'adaugat').length,
        sterse: schimbari.filter((s) => s.fel === 'sters').length,
        modificate: schimbari.filter((s) => s.fel === 'modificat').length,
        neschimbate: schimbari.filter((s) => s.fel === 'neschimbat').length,
      },
    }
  })
}
