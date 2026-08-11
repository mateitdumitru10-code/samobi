import {
  model,
  recipe,
  recipeLine,
  sagaArticle,
  sagaSync,
  unmappedMaterial,
  unmappedMaterialOcurenta,
} from '@samobi/shared/db'
import { esteTextil } from '@samobi/shared/nomenclator'
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { scrieAudit } from '../audit.js'
import { autentifica, ceruRol, TOTI, utilizatorul, type VerificatorToken } from '../auth.js'
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
    preHandler: [autentifica(verifica), ceruRol(...TOTI)],
  }
  const doarTehnolog = { preHandler: [autentifica(verifica), ceruRol(...TOTI)] }

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

  /**
   * The fabrics, ordered by how much of the range uses them.
   *
   * A bon almost always goes out in a fabric the workshop already works with,
   * so the screen offers those first and falls back to searching the whole
   * catalogue. „Popular" is measured over the recipes rather than over past
   * bons: the recipes came out of a year and a half of real production, and
   * there are no bons yet to learn from.
   */
  app.get('/nomenclator/stofe', oricineAutentificat, async (cerere) => {
    const { cauta, limita, toate } = z
      .object({
        cauta: z.string().trim().max(120).optional(),
        limita: z.coerce.number().int().min(1).max(200).default(24),
        /**
         * Drops the fabric test and searches everything sold by the metre. A
         * new fabric arrives before anyone updates a rule about names, and the
         * bon still has to go out that day.
         */
        toate: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
      })
      .parse(cerere.query)

    const cautare = cauta === undefined || cauta === '' ? null : `%${cauta}%`

    // Counted from the note each variable line carries, not from `cod_saga`:
    // a line that asks for a fabric has no article on it, by construction.
    // `[0-9]` rather than `\d`, which a template literal eats before Postgres
    // ever sees it — the pattern then matched nothing and every count was zero.
    const folosiri = new Map(
      (
        await db.execute<{ cod: string; n: number }>(sql`
          select substring(${recipeLine.observatii} from 'atunci: ([0-9]{6,10})') as cod,
                 count(*)::int as n
          from ${recipeLine}
          where ${recipeLine.observatii} like '%stofa folosită atunci:%'
          group by 1`)
      ).map((r) => [r.cod, Number(r.n)]),
    )

    const conditii: SQL[] = [
      eq(sagaArticle.activ, true),
      sql`upper(btrim(${sagaArticle.um})) in ('ML', 'M')`,
    ]
    if (!toate) {
      // Every one of the 103 fabrics the recipes name is filed here. Without
      // this the metre is the only test, and the metre also buys electrical
      // cable and steel profile.
      conditii.push(eq(sagaArticle.gestiuneImplicita, 'MATERII PRIME'))
    }
    if (cautare !== null) {
      const cautaIn = or(ilike(sagaArticle.denumire, cautare), ilike(sagaArticle.codSaga, cautare))
      if (cautaIn !== undefined) conditii.push(cautaIn)
    }

    const randuri = await db
      .select({
        codSaga: sagaArticle.codSaga,
        denumire: sagaArticle.denumire,
        um: sagaArticle.um,
        pretReferinta: sagaArticle.pretReferinta,
        pretConsum: sagaArticle.pretConsum,
        stoc: sagaArticle.stoc,
        tip: sagaArticle.tip,
      })
      .from(sagaArticle)
      .where(and(...conditii))
      .orderBy(asc(sagaArticle.denumire))

    // The unit alone lets zips and webbing through; the shared rule keeps them
    // out, and it is the same one the importer marks recipe lines with.
    const stofe = randuri
      .filter((a) => toate || esteTextil(a.denumire, a.um))
      .map((a) => ({ ...a, folosiri: folosiri.get(a.codSaga) ?? 0 }))
      .sort((a, b) => b.folosiri - a.folosiri || a.denumire.localeCompare(b.denumire))

    return { stofe: stofe.slice(0, limita), total: stofe.length }
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

    // The unit is what makes an export land wrong, and price and stock are the
    // best available answer to „is this the article the workshop really uses?".
    // Deciding on the name alone was the one thing this screen exists to prevent.
    const articole = new Map(
      codurile.length === 0
        ? []
        : (
            await db
              .select({
                codSaga: sagaArticle.codSaga,
                um: sagaArticle.um,
                tip: sagaArticle.tip,
                pretReferinta: sagaArticle.pretReferinta,
                pretConsum: sagaArticle.pretConsum,
                stoc: sagaArticle.stoc,
              })
              .from(sagaArticle)
              .where(inArray(sagaArticle.codSaga, [...new Set(codurile)]))
          ).map((a) => [a.codSaga, a]),
    )

    return randuri.map((rand) => ({
      id: rand.id,
      denumireExterna: rand.denumireExterna,
      sugestieCodSaga: rand.sugestieCodSaga,
      amanat: rand.amanat,
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
      sugestii: ((rand.sugestii as SugestieSalvata[] | null) ?? []).map((s) => {
        const articol = articole.get(s.codSaga)
        return {
          ...s,
          um: articol?.um ?? '',
          tip: articol?.tip ?? null,
          pretReferinta: articol?.pretReferinta ?? null,
          pretConsum: articol?.pretConsum ?? null,
          stoc: articol?.stoc ?? null,
        }
      }),
    }))
  })

  /** Put a name aside without deciding it. The hard ones stop being re-read. */
  app.post('/nomenclator/nemapate/:id/amanare', doarTehnolog, async (cerere) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(cerere.params)
    const { amanat } = z.object({ amanat: z.boolean() }).parse(cerere.body)

    const [rand] = await db
      .update(unmappedMaterial)
      .set({ amanat })
      .where(eq(unmappedMaterial.id, id))
      .returning({ id: unmappedMaterial.id, amanat: unmappedMaterial.amanat })

    if (rand === undefined) throw new NuExista('Intrarea nu există.')
    return rand
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

  /**
   * Takes a mapping back.
   *
   * A hundred decisions in a row is work nobody does carefully if every click is
   * final, and a confirmation in front of each one is pure friction. The way out
   * of that is an undo, so the only lines removed are the ones this mapping
   * created and nobody has touched since — matched on the article, the position
   * and the note the mapping wrote. Anything edited afterwards is somebody's
   * work and stays where it is.
   */
  app.post('/nomenclator/nemapate/:id/anulare', doarTehnolog, async (cerere) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(cerere.params)
    const utilizator = utilizatorul(cerere)

    const rezultat = await db.transaction(async (tx) => {
      const [material] = await tx
        .select()
        .from(unmappedMaterial)
        .where(eq(unmappedMaterial.id, id))
        .limit(1)
      if (material === undefined) throw new NuExista('Intrarea nu există.')
      if (!material.rezolvat || material.sugestieCodSaga === null) {
        throw new CerereInvalida('Intrarea nu e rezolvată — nu am ce anula.')
      }

      const ocurente = await tx
        .select()
        .from(unmappedMaterialOcurenta)
        .where(
          and(
            eq(unmappedMaterialOcurenta.unmappedMaterialId, id),
            eq(unmappedMaterialOcurenta.aplicat, true),
          ),
        )

      const draft = new Set(
        ocurente.length === 0
          ? []
          : (
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

      const desfacute: string[] = []
      const pastrate: string[] = []

      for (const o of ocurente) {
        if (!draft.has(o.recipeId)) {
          pastrate.push(o.id)
          continue
        }
        const sterse = await tx
          .delete(recipeLine)
          .where(
            and(
              eq(recipeLine.recipeId, o.recipeId),
              eq(recipeLine.nrLinie, o.nrLinie),
              eq(recipeLine.codSaga, material.sugestieCodSaga),
              eq(
                recipeLine.observatii,
                `mapat din „${material.denumireExterna}", poziția ${o.nrLinie}`,
              ),
            ),
          )
          .returning({ id: recipeLine.id })

        if (sterse.length > 0) desfacute.push(o.id)
        else pastrate.push(o.id)
      }

      if (desfacute.length > 0) {
        await tx
          .update(unmappedMaterialOcurenta)
          .set({ aplicat: false })
          .where(inArray(unmappedMaterialOcurenta.id, desfacute))

        await tx
          .update(recipe)
          .set({ lockVersion: sql`${recipe.lockVersion} + 1` })
          .where(inArray(recipe.id, [...draft]))
      }

      await tx
        .update(unmappedMaterial)
        .set({ rezolvat: false, rezolvatDe: null, rezolvatLa: null, sugestieCodSaga: null })
        .where(eq(unmappedMaterial.id, id))

      return {
        denumire: material.denumireExterna,
        codSaga: material.sugestieCodSaga,
        liniiSterse: desfacute.length,
        liniiPastrate: pastrate.length,
      }
    })

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'unmapped_material',
      entitateId: id,
      actiune: 'modificare',
      diff: { anulare: rezultat },
    })

    return rezultat
  })
}
