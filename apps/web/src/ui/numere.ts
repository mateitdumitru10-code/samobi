/**
 * Display formatting, and nothing else.
 *
 * Quantities and prices live as strings the whole way through, per the project
 * rule — the `Number` here is the last step before the pixel and never travels
 * back into a calculation or a request body.
 */

/** A quantity: Romanian comma, at most three decimals, as in the XLSX. */
export function cant(valoare: string | number | null | undefined): string {
  if (valoare === null || valoare === undefined || valoare === '') return '—'
  const n = Number(valoare)
  if (!Number.isFinite(n)) return String(valoare)
  return n.toLocaleString('ro-RO', { maximumFractionDigits: 3 })
}

/** Money, always two decimals. The unit belongs in the column header. */
export function lei(valoare: string | number | null | undefined): string {
  if (valoare === null || valoare === undefined || valoare === '') return '—'
  const n = Number(valoare)
  if (!Number.isFinite(n)) return String(valoare)
  return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** `2026-08-10` → `10.08.2026`. */
export function dataRo(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  const parti = iso.slice(0, 10).split('-')
  if (parti.length !== 3) return iso
  return `${parti[2]}.${parti[1]}.${parti[0]}`
}

/**
 * A quantity as typed by someone Romanian: `1,5` means one and a half.
 * Returns the string the API expects, or null if it is not a number at all.
 */
export function normalizeazaZecimala(text: string): string | null {
  const curat = text.trim().replace(',', '.')
  if (curat === '') return null
  if (!/^\d+(\.\d+)?$/.test(curat)) return null
  if (Number(curat) <= 0) return null
  return curat
}
