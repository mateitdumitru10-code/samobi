/** SAGA article codes are exactly 8 characters in the live catalogue. */
export const LUNGIME_COD_SAGA = 8

/**
 * Restores a SAGA code that Excel may have mangled into a number.
 *
 * '00016024' read as a number comes back as 16024, and re-importing that into
 * SAGA fails silently — it simply matches nothing. Padding to 8 characters puts
 * the leading zeros back.
 *
 * Codes that already contain a letter (the catalogue has a handful starting with
 * 'T') are left alone: Excel never turned those into numbers, so their length is
 * whatever SAGA says it is.
 */
export function normalizeazaCodSaga(valoare: string | number | null | undefined): string | null {
  if (valoare === null || valoare === undefined) return null

  const text = String(valoare).trim()
  if (text === '') return null

  if (!/^\d+$/.test(text)) return text.toUpperCase()
  if (text.length >= LUNGIME_COD_SAGA) return text

  return text.padStart(LUNGIME_COD_SAGA, '0')
}
