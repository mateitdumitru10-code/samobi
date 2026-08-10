import { sagaArticle, sagaSync } from '@samobi/shared/db'
import { esteUmCunoscuta } from '@samobi/shared/nomenclator'
import { inArray, sql } from 'drizzle-orm'

import { db } from '../db.js'

import { agregaArticole, type ArticolAgregat } from './agregare.js'
import { citesteNomenclator } from './citire.js'

export interface RaportImport {
  fisier: string
  articoleInFisier: number
  randuriInFisier: number
  noi: number
  modificate: number
  neschimbate: number
  disparute: number
  /** Sample of what changed, so the report is checkable rather than merely trusted. */
  exempleNoi: { codSaga: string; denumire: string }[]
  exempleModificate: { codSaga: string; denumire: string; schimbari: string[] }[]
  exempleDisparute: { codSaga: string; denumire: string }[]
  umNecunoscute: { um: string; articole: number }[]
  syncId: string
}

/** Postgres caps a statement at 65535 parameters; 11 columns per row leaves room. */
const DIMENSIUNE_LOT = 500

function egal(a: string | null, b: string | null): boolean {
  return (a ?? '') === (b ?? '')
}

function egalNumeric(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return Number(a) === Number(b)
}

function schimbari(
  vechi: {
    denumire: string
    um: string
    tip: string
    cont: string | null
    gestiuneImplicita: string | null
    pretReferinta: string | null
  },
  nou: ArticolAgregat,
  coloane: ReadonlySet<string>,
): string[] {
  const lista: string[] = []
  if (!egal(vechi.denumire, nou.denumire)) lista.push('denumire')
  if (!egal(vechi.um, nou.um)) lista.push('um')
  if (!egal(vechi.tip, nou.tip)) lista.push('tip')
  // A column the file does not carry cannot have changed. Counting it as a
  // difference made a harmless import look like it rewrote the whole catalogue.
  if (coloane.has('cont') && !egal(vechi.cont, nou.cont)) lista.push('cont')
  if (coloane.has('gestiune') && !egal(vechi.gestiuneImplicita, nou.gestiuneImplicita)) {
    lista.push('gestiune')
  }
  if (coloane.has('pret') && !egalNumeric(vechi.pretReferinta, nou.pretReferinta)) {
    lista.push('pret')
  }
  return lista
}

export interface OptiuniImport {
  fisier: string
  utilizatorId: string
  /**
   * Articles present in the database but missing from the file are only
   * deactivated when this is set. A partial export would otherwise switch off
   * the entire catalogue, and there is no undo.
   */
  dezactiveazaDisparute?: boolean
}

export async function importaNomenclator(
  continut: Buffer,
  optiuni: OptiuniImport,
): Promise<RaportImport> {
  const { randuri, coloane } = citesteNomenclator(continut)
  const articole = agregaArticole(randuri)

  const existente = await db
    .select({
      codSaga: sagaArticle.codSaga,
      denumire: sagaArticle.denumire,
      um: sagaArticle.um,
      tip: sagaArticle.tip,
      cont: sagaArticle.cont,
      gestiuneImplicita: sagaArticle.gestiuneImplicita,
      pretReferinta: sagaArticle.pretReferinta,
      activ: sagaArticle.activ,
    })
    .from(sagaArticle)

  const dupaCod = new Map(existente.map((a) => [a.codSaga, a]))
  const coduriInFisier = new Set(articole.map((a) => a.codSaga))

  const exempleNoi: RaportImport['exempleNoi'] = []
  const exempleModificate: RaportImport['exempleModificate'] = []
  let noi = 0
  let modificate = 0
  let neschimbate = 0

  for (const articol of articole) {
    const vechi = dupaCod.get(articol.codSaga)
    if (vechi === undefined) {
      noi += 1
      if (exempleNoi.length < 20) {
        exempleNoi.push({ codSaga: articol.codSaga, denumire: articol.denumire })
      }
      continue
    }
    const diferente = schimbari(vechi, articol, coloane)
    if (diferente.length === 0) {
      neschimbate += 1
      continue
    }
    modificate += 1
    if (exempleModificate.length < 20) {
      exempleModificate.push({
        codSaga: articol.codSaga,
        denumire: articol.denumire,
        schimbari: diferente,
      })
    }
  }

  const disparute = existente.filter((a) => !coduriInFisier.has(a.codSaga))

  const acum = new Date()

  for (let i = 0; i < articole.length; i += DIMENSIUNE_LOT) {
    const lot = articole.slice(i, i + DIMENSIUNE_LOT)
    await db
      .insert(sagaArticle)
      .values(
        lot.map((a) => ({
          codSaga: a.codSaga,
          denumire: a.denumire,
          um: a.um,
          umNormalizat: a.umNormalizat,
          tip: a.tip,
          tipSaga: a.tipSaga,
          cont: a.cont,
          gestiuneImplicita: a.gestiuneImplicita,
          categorie: a.categorie,
          pretReferinta: a.pretReferinta,
          activ: true,
          sincronizatLa: acum,
        })),
      )
      .onConflictDoUpdate({
        target: sagaArticle.codSaga,
        // Only the columns this file actually carries. Everything else keeps
        // what it already had: an export that omits a column is silent about it,
        // not asserting that it is empty.
        set: {
          denumire: sql`excluded.denumire`,
          um: sql`excluded.um`,
          umNormalizat: sql`excluded.um_normalizat`,
          tip: sql`excluded.tip`,
          ...(coloane.has('tipSaga') ? { tipSaga: sql`excluded.tip_saga` } : {}),
          ...(coloane.has('cont')
            ? { cont: sql`coalesce(excluded.cont, ${sagaArticle.cont})` }
            : {}),
          ...(coloane.has('gestiune')
            ? {
                gestiuneImplicita: sql`coalesce(excluded.gestiune_implicita, ${sagaArticle.gestiuneImplicita})`,
              }
            : {}),
          ...(coloane.has('categorie')
            ? { categorie: sql`coalesce(excluded.categorie, ${sagaArticle.categorie})` }
            : {}),
          ...(coloane.has('pret')
            ? { pretReferinta: sql`coalesce(excluded.pret_referinta, ${sagaArticle.pretReferinta})` }
            : {}),
          activ: sql`true`,
          sincronizatLa: acum,
        },
      })
  }

  if (optiuni.dezactiveazaDisparute === true && disparute.length > 0) {
    const coduri = disparute.map((a) => a.codSaga)
    for (let i = 0; i < coduri.length; i += DIMENSIUNE_LOT) {
      await db
        .update(sagaArticle)
        .set({ activ: false })
        .where(inArray(sagaArticle.codSaga, coduri.slice(i, i + DIMENSIUNE_LOT)))
    }
  }

  const [sync] = await db
    .insert(sagaSync)
    .values({
      rulatDe: optiuni.utilizatorId,
      articoleNoi: noi,
      articoleModificate: modificate,
      articoleDisparute: disparute.length,
      fisierNume: optiuni.fisier,
    })
    .returning({ id: sagaSync.id })

  // Units the application does not recognise are worth surfacing: a recipe line
  // in an unknown unit is a line nobody can check.
  const necunoscute = new Map<string, number>()
  for (const articol of articole) {
    if (articol.umNormalizat === null) continue
    if (!esteUmCunoscuta(articol.umNormalizat)) {
      necunoscute.set(articol.umNormalizat, (necunoscute.get(articol.umNormalizat) ?? 0) + 1)
    }
  }

  return {
    fisier: optiuni.fisier,
    articoleInFisier: articole.length,
    randuriInFisier: randuri.length,
    noi,
    modificate,
    neschimbate,
    disparute: disparute.length,
    exempleNoi,
    exempleModificate,
    exempleDisparute: disparute
      .slice(0, 20)
      .map((a) => ({ codSaga: a.codSaga, denumire: a.denumire })),
    umNecunoscute: [...necunoscute.entries()]
      .map(([um, articole]) => ({ um, articole }))
      .sort((a, b) => b.articole - a.articole),
    syncId: sync?.id ?? '',
  }
}
