import {
  dimension,
  model,
  recipe,
  recipeLine,
  recipeLineDimension,
  sagaArticle,
} from '@samobi/shared/db'
import { EroareCalcul, evalueazaFormula, valideazaFormula } from '@samobi/shared/calcul'
import {
  schemaSalvareReteta,
  schemaValidareFormula,
  type RezultatValidareFormula,
} from '@samobi/shared/scheme'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { scrieAudit } from '../audit.js'
import { autentifica, ceruRol, utilizatorul, type VerificatorToken } from '../auth.js'
import { db } from '../db.js'
import { CerereInvalida, Conflict, NuExista } from '../erori.js'

const schemaIdModel = z.object({ modelId: z.string().uuid('Identificator invalid.') })
const schemaIdReteta = z.object({ id: z.string().uuid('Identificator invalid.') })

export function ruteRetete(app: FastifyInstance, verifica: VerificatorToken) {
  const oricine = {
    preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog', 'operator', 'contabil')],
  }
  const doarTehnolog = { preHandler: [autentifica(verifica), ceruRol('admin', 'tehnolog')] }

  /**
   * The recipe of a model, with its lines and their per-dimension values.
   *
   * One recipe per model for now: versioning and approval arrive in module 8, so
   * a model without a recipe simply gets an empty draft created here.
   */
  app.get('/modele/:modelId/reteta', oricine, async (cerere) => {
    const { modelId } = schemaIdModel.parse(cerere.params)

    const [parinte] = await db.select().from(model).where(eq(model.id, modelId)).limit(1)
    if (parinte === undefined) throw new NuExista('Modelul nu există.')

    // The version being worked on: the draft if there is one, otherwise the
    // active one, otherwise whatever is newest. Returning the oldest version
    // meant the editor opened on an archived recipe once versions existed.
    const { versiuneId } = z
      .object({ versiuneId: z.string().uuid().optional() })
      .parse(cerere.query)

    const toate = await db
      .select()
      .from(recipe)
      .where(eq(recipe.modelId, modelId))
      .orderBy(desc(recipe.versiune))

    let reteta =
      versiuneId === undefined
        ? (toate.find((r) => r.status === 'draft') ??
          toate.find((r) => r.status === 'in_aprobare') ??
          toate.find((r) => r.status === 'activa') ??
          toate[0])
        : toate.find((r) => r.id === versiuneId)

    if (versiuneId !== undefined && reteta === undefined) {
      throw new NuExista('Versiunea cerută nu există pentru acest model.')
    }

    if (reteta === undefined) {
      const utilizator = utilizatorul(cerere)
      const [creata] = await db
        .insert(recipe)
        .values({ modelId, versiune: 1, status: 'draft', creatDe: utilizator.id })
        .returning()
      reteta = creata
    }
    if (reteta === undefined) throw new NuExista('Rețeta nu a putut fi creată.')

    const linii = await db
      .select({
        id: recipeLine.id,
        nrLinie: recipeLine.nrLinie,
        grup: recipeLine.grup,
        codSaga: recipeLine.codSaga,
        esteVariabil: recipeLine.esteVariabil,
        categorieVariabila: recipeLine.categorieVariabila,
        um: recipeLine.um,
        modCalcul: recipeLine.modCalcul,
        cantitateFixa: recipeLine.cantitateFixa,
        formula: recipeLine.formula,
        procentPierderi: recipeLine.procentPierderi,
        gestiuneDescarcare: recipeLine.gestiuneDescarcare,
        obligatoriu: recipeLine.obligatoriu,
        observatii: recipeLine.observatii,
        denumireMaterial: sagaArticle.denumire,
        // The catalogue's average when there is one, otherwise what the article
        // last cost on a bon. Both are stated, so the grid can say which it used.
        pretReferinta: sagaArticle.pretReferinta,
        pretConsum: sagaArticle.pretConsum,
        pretConsumLa: sagaArticle.pretConsumLa,
        umSaga: sagaArticle.um,
      })
      .from(recipeLine)
      .leftJoin(sagaArticle, eq(sagaArticle.codSaga, recipeLine.codSaga))
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

    const dupaLinie = new Map<string, typeof valori>()
    for (const valoare of valori) {
      const grup = dupaLinie.get(valoare.recipeLineId)
      if (grup === undefined) dupaLinie.set(valoare.recipeLineId, [valoare])
      else grup.push(valoare)
    }

    const dimensiuni = await db
      .select()
      .from(dimension)
      .where(and(eq(dimension.modelId, modelId), eq(dimension.activ, true)))
      .orderBy(asc(dimension.cod))

    return {
      id: reteta.id,
      modelId,
      versiune: reteta.versiune,
      status: reteta.status,
      lockVersion: reteta.lockVersion,
      dimensiuni,
      linii: linii.map((linie) => ({
        ...linie,
        valoriPeDimensiuni: (dupaLinie.get(linie.id) ?? []).map((v) => ({
          dimensiuneId: v.dimensionId,
          cantitate: v.cantitate,
          esteOverride: v.esteOverride,
          motiv: v.motiv,
          setatDe: v.setatDe,
          setatLa: v.setatLa?.toISOString() ?? null,
        })),
      })),
    }
  })

  /**
   * Saves the whole line set at once.
   *
   * A recipe is edited as a grid, so a partial save would leave line numbers and
   * per-dimension values inconsistent halfway through. `lock_version` is checked
   * and bumped inside the same transaction: two people editing the same recipe
   * cannot both win, and the loser is told so rather than silently overwritten.
   */
  app.put('/retete/:id', doarTehnolog, async (cerere) => {
    const { id } = schemaIdReteta.parse(cerere.params)
    const { lockVersion, linii } = schemaSalvareReteta.parse(cerere.body)
    const utilizator = utilizatorul(cerere)

    const numere = new Set(linii.map((l) => l.nrLinie))
    if (numere.size !== linii.length) {
      throw new CerereInvalida('Există două linii cu același număr.')
    }

    for (const linie of linii) {
      if (linie.modCalcul === 'formula' && linie.formula !== null) {
        try {
          valideazaFormula(linie.formula, linie.nrLinie)
        } catch (err) {
          if (err instanceof EroareCalcul) throw new CerereInvalida(err.message)
          throw err
        }
      }
    }

    const coduri = linii.map((l) => l.codSaga).filter((c): c is string => c !== null)
    if (coduri.length > 0) {
      const gasite = await db
        .select({ codSaga: sagaArticle.codSaga })
        .from(sagaArticle)
        .where(inArray(sagaArticle.codSaga, coduri))
      const cunoscute = new Set(gasite.map((g) => g.codSaga))
      const lipsa = [...new Set(coduri)].filter((c) => !cunoscute.has(c))
      if (lipsa.length > 0) {
        throw new CerereInvalida(
          `Coduri care nu există în nomenclator: ${lipsa.join(', ')}. Importă nomenclatorul întâi.`,
        )
      }

      // An article whose unit is blank in SAGA is not an error here: the recipe
      // line carries the unit, and the export falls back to it. Blocking the
      // save would forbid perfectly good materials — four fabrics in the live
      // catalogue are in exactly that state.
    }

    const rezultat = await db.transaction(async (tx) => {
      const [curenta] = await tx.select().from(recipe).where(eq(recipe.id, id)).limit(1)
      if (curenta === undefined) throw new NuExista('Rețeta nu există.')

      if (curenta.lockVersion !== lockVersion) {
        throw new Conflict(
          'Altcineva a salvat rețeta între timp. Reîncarcă pagina și reia modificările — ' +
            'altfel i-ai șterge munca.',
        )
      }
      if (curenta.status === 'activa' || curenta.status === 'arhivata') {
        // Immutability of approved recipes arrives with module 8; the door is
        // shut now so no bon can silently change meaning in the meantime.
        throw new Conflict('O rețetă activă nu se modifică. Creează o versiune nouă.')
      }

      // Replace wholesale. Cascade removes the per-dimension values with them.
      await tx.delete(recipeLine).where(eq(recipeLine.recipeId, id))

      for (const linie of linii) {
        const [inserata] = await tx
          .insert(recipeLine)
          .values({
            recipeId: id,
            nrLinie: linie.nrLinie,
            grup: linie.grup,
            codSaga: linie.codSaga,
            esteVariabil: linie.esteVariabil,
            categorieVariabila: linie.categorieVariabila,
            um: linie.um,
            modCalcul: linie.modCalcul,
            cantitateFixa: linie.cantitateFixa,
            formula: linie.formula,
            procentPierderi: linie.procentPierderi,
            gestiuneDescarcare: linie.gestiuneDescarcare,
            obligatoriu: linie.obligatoriu,
            observatii: linie.observatii,
          })
          .returning({ id: recipeLine.id })

        const linieId = inserata?.id
        if (linieId === undefined) throw new Error('Linia nu a putut fi salvată.')

        if (linie.valoriPeDimensiuni.length > 0) {
          await tx.insert(recipeLineDimension).values(
            linie.valoriPeDimensiuni.map((v) => ({
              recipeLineId: linieId,
              dimensionId: v.dimensiuneId,
              cantitate: v.cantitate,
              esteOverride: v.esteOverride,
              motiv: v.motiv ?? null,
              // Who and when are recorded here, not sent by the client: an
              // override's provenance is not the client's to claim.
              setatDe: v.esteOverride ? utilizator.id : null,
              setatLa: v.esteOverride ? new Date() : null,
            })),
          )
        }
      }

      const [actualizata] = await tx
        .update(recipe)
        .set({ lockVersion: curenta.lockVersion + 1 })
        .where(eq(recipe.id, id))
        .returning({ lockVersion: recipe.lockVersion })

      return { lockVersion: actualizata?.lockVersion ?? curenta.lockVersion + 1 }
    })

    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'recipe',
      entitateId: id,
      actiune: 'modificare',
      diff: { nrLinii: linii.length, lockVersion: rezultat.lockVersion },
    })

    return rezultat
  })

  /**
   * Validates a formula and, given a dimension, shows what it produces there.
   *
   * The tehnolog should see the number before saving, not discover it on a bon.
   */
  app.post('/retete/valideaza-formula', doarTehnolog, async (cerere) => {
    const { formula, dimensiuneId } = schemaValidareFormula.parse(cerere.body)

    const raspuns: RezultatValidareFormula = {
      valida: false,
      mesaj: null,
      variabile: [],
      previzualizare: null,
    }

    let validata
    try {
      validata = valideazaFormula(formula)
    } catch (err) {
      raspuns.mesaj = err instanceof EroareCalcul ? err.message : 'Formula nu este validă.'
      return raspuns
    }

    raspuns.valida = true
    raspuns.variabile = [...validata.variabile]

    if (dimensiuneId === undefined) return raspuns

    const [dim] = await db.select().from(dimension).where(eq(dimension.id, dimensiuneId)).limit(1)
    if (dim === undefined) {
      raspuns.mesaj = 'Dimensiunea aleasă nu există.'
      return raspuns
    }
    if (validata.foloseteInaltime && dim.inaltime === null) {
      raspuns.mesaj = `Dimensiunea ${dim.cod} nu are înălțime, iar formula folosește H.`
      return raspuns
    }

    const rezultat = evalueazaFormula(formula, {
      L: Number(dim.lungime),
      l: Number(dim.latime),
      H: dim.inaltime === null ? null : Number(dim.inaltime),
    })

    if (!rezultat.esteNumar) {
      raspuns.valida = false
      raspuns.mesaj = `Pe dimensiunea ${dim.cod} formula nu produce un număr. Verifică împărțirile la zero.`
      return raspuns
    }

    raspuns.previzualizare = {
      dimensiune: dim.cod,
      expresieEvaluata: rezultat.expresieEvaluata,
      valoare: rezultat.valoare.toString(),
    }
    return raspuns
  })
}
