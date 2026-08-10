/**
 * Suggesting a SAGA article for a material named by hand on a paper recipe sheet.
 *
 * The scanned sheets say 'STOFA ENJOY', 'CHERESTEA RAS', 'POL.2542 2000x130x60'.
 * The catalogue says something close but rarely identical. Trigram overlap
 * handles the abbreviations and the missing spaces better than exact matching
 * ever could, and is cheap enough to run against 21.000 rows.
 */

function faraDiacritice(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Uppercase, unaccented, punctuation collapsed to single spaces.
 *
 * Dimension separators are levelled first: the sheets write `1900x680x40`, the
 * catalogue writes `1900*680*40`, and without this they share almost no
 * trigrams even though they name the same block of foam.
 */
export function normalizeazaDenumire(text: string): string {
  let curatat = faraDiacritice(text).toUpperCase()
  // Twice, because the separators overlap: 1900X680X40 consumes the first match
  // and would otherwise leave the second X in place.
  for (let i = 0; i < 2; i += 1) {
    curatat = curatat.replace(/(\d)\s*[X×*]\s*(\d)/g, '$1 $2')
  }
  return curatat.replace(/[^A-Z0-9]+/g, ' ').trim()
}

function trigrame(text: string): Set<string> {
  const pregatit = `  ${normalizeazaDenumire(text)}  `
  const set = new Set<string>()
  for (let i = 0; i + 3 <= pregatit.length; i += 1) {
    set.add(pregatit.slice(i, i + 3))
  }
  return set
}

/** Dice coefficient over trigrams: 1 identical, 0 nothing in common. */
export function scorSimilaritate(a: string, b: string): number {
  const normalA = normalizeazaDenumire(a)
  const normalB = normalizeazaDenumire(b)
  if (normalA === '' || normalB === '') return 0
  if (normalA === normalB) return 1

  const setA = trigrame(a)
  const setB = trigrame(b)
  let comune = 0
  for (const g of setA) if (setB.has(g)) comune += 1

  return (2 * comune) / (setA.size + setB.size)
}

/** Every number in a name, in order. '2538 1900*680*40' → [2538, 1900, 680, 40]. */
export function numereDin(text: string): string[] {
  return (normalizeazaDenumire(text).match(/\d+(?:\s\d+)*/g) ?? [])
    .flatMap((grup) => grup.split(' '))
    .filter((n) => n !== '')
}

/**
 * Whether a match can be accepted without a person looking at it.
 *
 * In this catalogue the numbers carry the meaning: dimensions, gauges, sizes.
 * `CAPSE 38/12` and `CAPSE 80/12` are different staples and score alike on
 * letters alone, while `POL.2538 1900x680x40` and `POLIURETAN 2538 1900*680*40`
 * are the same block of foam written two ways. So a middling score is trusted
 * only when every number agrees, and a name with no numbers at all — VATELINA
 * against VASELINA — is never trusted on letters alone.
 */
export function potrivireSigura(externa: string, candidat: string, scor: number): boolean {
  if (scor >= 0.9) return true

  const numereExterne = numereDin(externa)
  const numereCandidat = numereDin(candidat)
  if (numereExterne.length === 0) return false

  const aceleasi =
    numereExterne.length === numereCandidat.length &&
    numereExterne.every((n, i) => n === numereCandidat[i])

  return aceleasi && scor >= 0.7
}

export interface Candidat {
  codSaga: string
  denumire: string
}

export interface Sugestie extends Candidat {
  scor: number
}

/** Best matches above `prag`, strongest first. */
export function sugereaza(
  denumireExterna: string,
  candidati: readonly Candidat[],
  optiuni: { limita?: number; prag?: number } = {},
): Sugestie[] {
  const limita = optiuni.limita ?? 5
  const prag = optiuni.prag ?? 0.35

  const scoruri: Sugestie[] = []
  for (const candidat of candidati) {
    const scor = scorSimilaritate(denumireExterna, candidat.denumire)
    if (scor >= prag) scoruri.push({ ...candidat, scor })
  }

  scoruri.sort((a, b) => b.scor - a.scor || a.codSaga.localeCompare(b.codSaga))
  return scoruri.slice(0, limita)
}
