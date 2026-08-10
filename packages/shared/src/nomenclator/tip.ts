import type { TipArticol } from '../db/schema.js'

/**
 * SAGA reports 19 distinct `den_tip` values, not the two the spec assumed, and
 * the free-text label is inconsistent between exports. The accounting account is
 * the reliable classifier: it is what the accountant actually books against.
 *
 *   345*  produse finite
 *   371*  mărfuri
 *   301*  materii prime      302*  materiale consumabile      381  ambalaje
 *   303   obiecte de inventar     21x, 23x  imobilizări
 *
 * Packaging counts as raw material because AMBALAJ is one of the recipe groups —
 * it is consumed per product like anything else. Inventory objects and fixed
 * assets are not consumed by a recipe, so they land in `altele` and stay out of
 * the material picker.
 */
export function tipDupaCont(cont: string | null | undefined): TipArticol | null {
  if (cont === null || cont === undefined) return null
  const curat = cont.trim()
  if (curat === '') return null

  if (curat.startsWith('345')) return 'produs'
  if (curat.startsWith('371')) return 'marfa'
  if (curat.startsWith('303')) return 'altele'
  if (curat.startsWith('301') || curat.startsWith('302') || curat.startsWith('381')) {
    return 'materie_prima'
  }
  return 'altele'
}

const DUPA_DENUMIRE: Readonly<Record<string, TipArticol>> = {
  'produse finite': 'produs',
  marfuri: 'marfa',
  'materii prime': 'materie_prima',
  'alte mat. consumabile': 'materie_prima',
  'materiale auxiliare': 'materie_prima',
  'materiale recuperate': 'materie_prima',
  'piese de schimb': 'materie_prima',
  combustibili: 'materie_prima',
  ambalaje: 'materie_prima',
}

function faraDiacritice(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function tipDupaDenumire(denTip: string | null | undefined): TipArticol | null {
  if (denTip === null || denTip === undefined) return null
  const cheie = faraDiacritice(denTip.trim().toLowerCase())
  if (cheie === '') return null
  return DUPA_DENUMIRE[cheie] ?? 'altele'
}

/** The account wins; the label is the fallback; unknown becomes `altele`. */
export function determinaTip(
  cont: string | null | undefined,
  denTip: string | null | undefined,
): TipArticol {
  return tipDupaCont(cont) ?? tipDupaDenumire(denTip) ?? 'altele'
}
