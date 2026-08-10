import { sagaArticle, sagaSync, unmappedMaterial } from '@samobi/shared/db'
import { sugereaza } from '@samobi/shared/nomenclator'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

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

    const catalog = await db
      .select({ codSaga: sagaArticle.codSaga, denumire: sagaArticle.denumire })
      .from(sagaArticle)
      .where(
        and(
          eq(sagaArticle.activ, true),
          eq(sagaArticle.tip, 'materie_prima'),
          // An article with no unit cannot be the answer: SAGA would refuse it.
          sql`btrim(${sagaArticle.um}) <> ''`,
        ),
      )

    return randuri.map((rand) => ({
      id: rand.id,
      denumireExterna: rand.denumireExterna,
      sugestieCodSaga: rand.sugestieCodSaga,
      creatLa: rand.creatLa.toISOString(),
      sugestii: sugereaza(rand.denumireExterna, catalog),
    }))
  })

  app.post('/nomenclator/nemapate/:id/rezolvare', doarTehnolog, async (cerere) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(cerere.params)
    const { codSaga } = schemaRezolvare.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const [articol] = await db
      .select({ codSaga: sagaArticle.codSaga })
      .from(sagaArticle)
      .where(eq(sagaArticle.codSaga, codSaga))
      .limit(1)
    if (articol === undefined) throw new NuExista('Articolul ales nu există în nomenclator.')

    const [actualizat] = await db
      .update(unmappedMaterial)
      .set({
        sugestieCodSaga: codSaga,
        rezolvat: true,
        rezolvatDe: utilizator.id,
        rezolvatLa: new Date(),
      })
      .where(eq(unmappedMaterial.id, id))
      .returning()

    if (actualizat === undefined) throw new NuExista('Intrarea nu există.')
    return actualizat
  })
}
