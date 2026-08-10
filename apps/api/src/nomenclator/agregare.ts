import type { RandNomenclator } from './citire.js'

export interface ArticolAgregat {
  codSaga: string
  denumire: string
  um: string
  umNormalizat: string | null
  tip: RandNomenclator['tip']
  tipSaga: string | null
  cont: string | null
  gestiuneImplicita: string | null
  categorie: string | null
  pretReferinta: string | null
}

/** Where raw materials are booked, and therefore the sensible default. */
const GESTIUNE_PREFERATA = 'MATERII PRIME'

/**
 * Collapses the stock report's article-per-warehouse rows into one row per
 * article.
 *
 * The only real decision is which warehouse to record as the default. The one
 * holding stock is the honest answer — that is where the material will actually
 * be issued from. With no stock anywhere, MATERII PRIME wins, and failing that
 * the first warehouse in alphabetical order, so repeated imports of the same
 * file produce the same result.
 *
 * The reference price is the highest non-zero average across warehouses: a
 * warehouse with no stock reports a price of zero, which would otherwise make
 * every costing come out at nothing.
 */
export function agregaArticole(randuri: readonly RandNomenclator[]): ArticolAgregat[] {
  const dupaCod = new Map<string, RandNomenclator[]>()

  for (const rand of randuri) {
    const grup = dupaCod.get(rand.cod)
    if (grup === undefined) dupaCod.set(rand.cod, [rand])
    else grup.push(rand)
  }

  const articole: ArticolAgregat[] = []

  for (const [cod, grup] of dupaCod) {
    const sortate = [...grup].sort((a, b) => {
      if (b.stoc !== a.stoc) return b.stoc - a.stoc
      const aPreferata = a.gestiune === GESTIUNE_PREFERATA ? 0 : 1
      const bPreferata = b.gestiune === GESTIUNE_PREFERATA ? 0 : 1
      if (aPreferata !== bPreferata) return aPreferata - bPreferata
      return (a.gestiune ?? '').localeCompare(b.gestiune ?? '')
    })

    const principal = sortate[0]
    if (principal === undefined) continue

    let pret: string | null = null
    let pretMax = 0
    for (const rand of grup) {
      const valoare = rand.pret === null ? 0 : Number(rand.pret)
      if (Number.isFinite(valoare) && valoare > pretMax) {
        pretMax = valoare
        pret = rand.pret
      }
    }

    articole.push({
      codSaga: cod,
      denumire: principal.denumire,
      um: principal.um,
      umNormalizat: principal.umNormalizat,
      tip: principal.tip,
      tipSaga: principal.tipSaga,
      cont: principal.cont,
      gestiuneImplicita: principal.gestiune,
      categorie: principal.categorie,
      pretReferinta: pret,
    })
  }

  articole.sort((a, b) => a.codSaga.localeCompare(b.codSaga))
  return articole
}
