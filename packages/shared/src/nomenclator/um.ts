/**
 * The live SAGA catalogue holds 90 distinct spellings of about 20 real units:
 * '  BUC', ' BUC', 'BUC`', 'BYC' and 'BIUC' are all pieces; 'MIIB', 'MII B',
 * 'MIIBU', '1000B' and 'MII' are all thousands of pieces.
 *
 * The raw string stays untouched in `saga_article.um`, because the export back
 * into SAGA has to carry exactly what SAGA expects. This normalised value is for
 * our own use: validating that a recipe line and its article agree, and grouping
 * in reports.
 *
 * The mapping is deliberately conservative. Where the intent is genuinely
 * ambiguous — 'M' could be metres or linear metres, 'GAL' could be gallons or
 * anything else — the cleaned-up string is returned unchanged rather than
 * guessed at.
 */

const SINONIME: Readonly<Record<string, string>> = {
  // bucăți
  B: 'BUC',
  BC: 'BUC',
  BCU: 'BUC',
  BIUC: 'BUC',
  BYC: 'BUC',
  'BUC`': 'BUC',
  PCS: 'BUC',
  PCT: 'BUC',
  UNIT: 'BUC',
  UN: 'BUC',
  EX: 'BUC',

  // mii de bucăți
  'MII B': 'MIIB',
  MIIBU: 'MIIB',
  MIIBUC: 'MIIB',
  MII: 'MIIB',
  '1000B': 'MIIB',
  MBUC: 'MIIB',
  MBC: 'MIIB',

  // sute de bucăți
  SUTE: 'SUTEB',
  '100BU': 'SUTEB',
  '100B': 'SUTEB',
  '100 B': 'SUTEB',
  B100: 'SUTEB',
  '100BC': 'SUTEB',
  SBUC: 'SUTEB',

  // suprafață și volum
  M2: 'MP',
  M3: 'MC',

  // ambalaje
  ROL: 'ROLA',
  ROLE: 'ROLA',
  CUTII: 'CUT',
  CUTIE: 'CUT',
  CT: 'CUT',
  PUNGI: 'PUNGA',
  PUN: 'PUNGA',

  // volum
  LITRI: 'L',
  LT: 'L',
}

/** Units the application understands well enough to reason about. */
export const UM_CUNOSCUTE = [
  'BUC',
  'ML',
  'MP',
  'MC',
  'KG',
  'SET',
  'MIIB',
  'SUTEB',
  'L',
  'ROLA',
  'CUT',
  'PUNGA',
  'SAC',
  'BAX',
] as const

export function normalizeazaUm(brut: string | null | undefined): string | null {
  if (brut === null || brut === undefined) return null

  const curat = brut.trim().toUpperCase().replace(/\s+/g, ' ')
  if (curat === '') return null

  return SINONIME[curat] ?? curat
}

/** True when the normalised unit is one the application knows how to handle. */
export function esteUmCunoscuta(um: string | null): boolean {
  return um !== null && (UM_CUNOSCUTE as readonly string[]).includes(um)
}
