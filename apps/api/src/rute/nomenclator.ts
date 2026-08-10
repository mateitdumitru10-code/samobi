import {
  model,
  recipe,
  recipeLine,
  sagaArticle,
  sagaSync,
  unmappedMaterial,
  unmappedMaterialOcurenta,
} from '@samobi/shared/db'
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { scrieAudit } from '../audit.js'
import { autentifica, ceruRol, utilizatorul, type VerificatorToken } from '../auth.js'
import { db } from '../db.js'
import { CerereInvalida, NuExista } from '../erori.js'
import { importaNomenclator } from '../nomenclator/import.js'

/** The live catalogue is ~21.600 articles; a full export is a few megabytes. */
const DIMENSIUNE_MAXIMA = 25 * 1024 * 1024

const schemaListare = z.object({
  cauta: z.string().trim().max(120).optional(),
  tip: z.enum(['produs', 'materie_prima', 'marfa', 'altele']).optional(),
  categorie: z.string().trim().max(60).optional(),
  gestiune: z.string().trim().max(60).optional(),
  doarActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
  /** Hides articles SAGA would refuse on import — used by the material picker. */
  doarUtilizabile: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  pagina: z.coerce.number().int().min(1).default(1),
  pePagina: z.coerce.number().int().min(1).max(200).default(50),
})

/** Shape of `unmapped_material.sugestii`, written when the material is queued. */
interface SugestieSalvata {
  codSaga: string
  denumire: string
  scor: number
}

const schemaRezolvare = z.object({
  codSaga: z.string().trim().min(1, 'Alege un articol.'),
})

export function ruteNomenclator(app: FastifyInstance, verifica: VerificatorToken) {
  const oricineAutentificat = {
    preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog', 'operator', 'contabil')],
  }
  const doarTehnolog = { preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog')] }

  /**
   * Import is one-way and by file: SAGA has no API, and nothing is ever written
   * back into its database.
   */
  app.post('/nomenclator/import', doarTehnolog, async (cerere) => {
    const utilizator = utilizatorul(cerere)
    const fisier = await cerere.file({ limits: { fileSize: DIMENSIUNE_MAXIMA } })

    if (fisier === undefined) {
      throw new CerereInvalida('Trimite un fișier XLSX în câmpul "fisier".')
    }
    if (!/\.xlsx$/i.test(fisier.filename)) {
      throw new CerereInvalida('Se acceptă doar fișiere .xlsx exportate din SAGA.')
    }

    const continut = await fisier.toBuffer()
    if (fisier.file.truncated) {
      throw new CerereInvalida('Fișierul depășește 25 MB.')
    }

    const dezactiveaza = (fisier.fields['dezactiveazaDisparute'] as { value?: string } | undefined)
      ?.value

    const raport = await importaNomenclator(continut, {
      fisier: fisier.filename,
      utilizatorId: utilizator.id,
      dezactiveazaDisparute: dezactiveaza === 'true',
    })

    cerere.log.info(
      { noi: raport.noi, modificate: raport.modificate, disparute: raport.disparute },
      'import nomenclator',
    )
    return raport
  })

  app.get('/nomenclator/importuri', oricineAutentificat, async () => {
    const randuri = await db
      .select()
      .from(sagaSync)
      .orderBy(desc(sagaSync.rulatLa))
      .limit(20)
    return randuri.map((r) => ({ ...r, rulatLa: r.rulatLa.toISOString() }))
  })

  app.get('/nomenclator', oricineAutentificat, async (cerere) => {
    const filtre = schemaListare.parse(cerere.query)

    const conditii: SQL[] = []
    if (filtre.doarActive) conditii.push(eq(sagaArticle.activ, true))
    if (filtre.doarUtilizabile) conditii.push(sql`btrim(${sagaArticle.um}) <> ''`)
    if (filtre.tip !== undefined) conditii.push(eq(sagaArticle.tip, filtre.tip))
    if (filtre.categorie !== undefined && filtre.categorie !== '') {
      conditii.push(eq(sagaArticle.categorie, filtre.categorie))
    }
    if (filtre.gestiune !== undefined && filtre.gestiune !== '') {
      conditii.push(eq(sagaArticle.gestiuneImplicita, filtre.gestiune))
    }
    if (filtre.cauta !== undefined && filtre.cauta !== '') {
      const tipar = `%${filtre.cauta}%`
      const cautare = or(ilike(sagaArticle.denumire, tipar), ilike(sagaArticle.codSaga, tipar))
      if (cautare !== undefined) conditii.push(cautare)
    }

    const unde = conditii.length > 0 ? and(...conditii) : undefined

    const [total] = await db.select({ n: count() }).from(sagaArticle).where(unde)

    const randuri = await db
      .select()
      .from(sagaArticle)
      .where(unde)
      .orderBy(asc(sagaArticle.denumire))
      .limit(filtre.pePagina)
      .offset((filtre.pagina - 1) * filtre.pePagina)

    return {
      total: total?.n ?? 0,
      pagina: filtre.pagina,
      pePagina: filtre.pePagina,
      articole: randuri.map((r) => ({
        ...r,
        sincronizatLa: r.sincronizatLa?.toISOString() ?? null,
      })),
    }
  })

  /** Distinct values, so the filters offer what the data actually contains. */
  app.get('/nomenclator/filtre', oricineAutentificat, async () => {
    const categorii = await db
      .selectDistinct({ valoare: sagaArticle.categorie })
      .from(sagaArticle)
      .where(sql`${sagaArticle.categorie} is not null`)
      .orderBy(asc(sagaArticle.categorie))

    const gestiuni = await db
      .selectDistinct({ valoare: sagaArticle.gestiuneImplicita })
      .from(sagaArticle)
      .where(sql`${sagaArticle.gestiuneImplicita} is not null`)
      .orderBy(asc(sagaArticle.gestiuneImplicita))

    return {
      categorii: categorii.map((c) => c.valoare).filter((v): v is string => v !== null),
      gestiuni: gestiuni.map((g) => g.valoare).filter((v): v is string => v !== null),
    }
  })

  /**
   * Materials named on a recipe that have no article behind them. They block the
   * export of any bon that uses them, so the queue is the thing to empty before
   * anything reaches SAGA.
   */
  app.get('/nomenclator/nemapate', oricineAutentificat, async () => {
    const randuri = await db
      .select()
      .from(unmappedMaterial)
      .where(eq(unmappedMaterial.rezolvat, false))
      .orderBy(asc(unmappedMaterial.denumireExterna))

    if (randuri.length === 0) return []

    const ocurente = await db
      .select({
        unmappedMaterialId: unmappedMaterialOcurenta.unmappedMaterialId,
        nrLinie: unmappedMaterialOcurenta.nrLinie,
        um: unmappedMaterialOcurenta.um,
        cantitate: unmappedMaterialOcurenta.cantitate,
        grup: unmappedMaterialOcurenta.grup,
        modelCod: model.cod,
        modelDenumire: model.denumire,
      })
      .from(unmappedMaterialOcurenta)
      .innerJoin(recipe, eq(recipe.id, unmappedMaterialOcurenta.recipeId))
      .innerJoin(model, eq(model.id, recipe.modelId))
      .where(eq(unmappedMaterialOcurenta.aplicat, false))
      .orderBy(asc(model.cod), asc(unmappedMaterialOcurenta.nrLinie))

    const dupaMaterial = new Map<string, typeof ocurente>()
    for (const o of ocurente) {
      const grup = dupaMaterial.get(o.unmappedMaterialId)
      if (grup === undefined) dupaMaterial.set(o.unmappedMaterialId, [o])
      else grup.push(o)
    }

    // Suggestions are worked out once, when the material is queued, and read
    // back here. Recomputing them cost 6,6 seconds of CPU per request: 171 names
    // against 14.329 articles, on every load and after every resolution.
    const codurile = randuri
      .flatMap((r) => (r.sugestii as SugestieSalvata[] | null) ?? [])
      .map((s) => s.codSaga)

    const um = new Map(
      codurile.length === 0
        ? []
        : (
            await db
              .select({ codSaga: sagaArticle.codSaga, um: sagaArticle.um })
              .from(sagaArticle)
              .where(inArray(sagaArticle.codSaga, [...new Set(codurile)]))
          ).map((a) => [a.codSaga, a.um]),
    )

    return randuri.map((rand) => ({
      id: rand.id,
      denumireExterna: rand.denumireExterna,
      sugestieCodSaga: rand.sugestieCodSaga,
      creatLa: rand.creatLa.toISOString(),
      // Where it appears, so the tehnolog sees what a decision will complete.
      ocurente: (dupaMaterial.get(rand.id) ?? []).map((o) => ({
        modelCod: o.modelCod,
        modelDenumire: o.modelDenumire,
        nrLinie: o.nrLinie,
        um: o.um,
        cantitate: o.cantitate,
        grup: o.grup,
      })),
      sugestii: ((rand.sugestii as SugestieSalvata[] | null) ?? []).map((s) => ({
        ...s,
        um: um.get(s.codSaga) ?? '',
      })),
    }))
  })

  /**
   * Resolving a material completes every recipe that was waiting on it.
   *
   * The decision is a mapping from a name on a paper sheet to a SAGA article, and
   * the same name sits on a dozen sheets. Recording the mapping without creating
   * the lines would leave the recipes exactly as incomplete as before.
   */
  app.post('/nomenclator/nemapate/:id/rezolvare', doarTehnolog, async (cerere) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(cerere.params)
    const { codSaga } = schemaRezolvare.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const [articol] = await db
      .select({ codSaga: sagaArticle.codSaga, um: sagaArticle.um })
      .from(sagaArticle)
      .where(eq(sagaArticle.codSaga, codSaga))
      .limit(1)
    if (articol === undefined) throw new NuExista('Articolul ales nu există în nomenclator.')

    const rezultat = await db.transaction(async (tx) => {
      const [material] = await tx
        .select()
        .from(unmappedMaterial)
        .where(eq(unmappedMaterial.id, id))
        .limit(1)
      if (material === undefined) throw new NuExista('Intrarea nu există.')

      const ocurente = await tx
        .select()
        .from(unmappedMaterialOcurenta)
        .where(
          and(
            eq(unmappedMaterialOcurenta.unmappedMaterialId, id),
            eq(unmappedMaterialOcurenta.aplicat, false),
          ),
        )

      if (ocurente.length === 0) {
        await tx
          .update(unmappedMaterial)
          .set({
            sugestieCodSaga: codSaga,
            rezolvat: true,
            rezolvatDe: utilizator.id,
            rezolvatLa: new Date(),
          })
          .where(eq(unmappedMaterial.id, id))
        return { denumire: material.denumireExterna, linii: 0, sarite: 0 }
      }

      // In batches, not one round trip per occurrence. A material can block
      // twenty recipes, and three statements each over a pooler in Ireland is
      // seconds of waiting for work the database does in one pass.
      const draft = new Set(
        (
          await tx
            .select({ id: recipe.id })
            .from(recipe)
            .where(
              and(
                inArray(
                  recipe.id,
                  ocurente.map((o) => o.recipeId),
                ),
                eq(recipe.status, 'draft'),
              ),
            )
        ).map((r) => r.id),
      )

      // An active recipe is immutable; completing it would change what a bon
      // already issued against it means.
      const deAplicat = ocurente.filter((o) => draft.has(o.recipeId))
      const sarite = ocurente.length - deAplicat.length

      if (deAplicat.length > 0) {
        await tx
          .insert(recipeLine)
          .values(
            deAplicat.map((o) => ({
              recipeId: o.recipeId,
              nrLinie: o.nrLinie,
              grup: o.grup,
              codSaga,
              esteVariabil: false,
              // The sheet's unit, as everywhere else: SAGA's own may be blank.
              um: o.um,
              modCalcul: 'fixa',
              cantitateFixa: o.cantitate,
              procentPierderi: '0',
              observatii: `mapat din „${material.denumireExterna}", poziția ${o.nrLinie}`,
            })),
          )
          .onConflictDoNothing()

        await tx
          .update(unmappedMaterialOcurenta)
          .set({ aplicat: true })
          .where(
            inArray(
              unmappedMaterialOcurenta.id,
              deAplicat.map((o) => o.id),
            ),
          )

        await tx
          .update(recipe)
          .set({ lockVersion: sql`${recipe.lockVersion} + 1` })
          .where(inArray(recipe.id, [...draft]))
      }

      await tx
        .update(unmappedMaterial)
        .set({
          sugestieCodSaga: codSaga,
          rezolvat: true,
          rezolvatDe: utilizator.id,
          rezolvatLa: new Date(),
        })
        .where(eq(unmappedMaterial.id, id))

      return { denumire: material.denumireExterna, linii: deAplicat.length, sarite }
    })

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'unmapped_material',
      entitateId: id,
      actiune: 'modificare',
      diff: { codSaga, ...rezultat },
    })

    return rezultat
  })
}
