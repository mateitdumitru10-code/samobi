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

/** Uppercase, unaccented, punctuation collapsed to single spaces. */
export function normalizeazaDenumire(text: string): string {
  return faraDiacritice(text)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
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
