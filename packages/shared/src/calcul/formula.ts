import { Parser } from 'expr-eval'

import { D, type Dec } from './decimal.js'
import { EroareFormulaInvalida, EroareVariabilaNecunoscuta } from './erori.js'

/** The only variables a recipe formula may reference. All in millimetres. */
export const VARIABILE_PERMISE = ['L', 'l', 'H'] as const
export type VariabilaPermisa = (typeof VARIABILE_PERMISE)[number]

export type ScopFormula = { L: number; l: number; H: number | null }

/** Test values used to prove a formula evaluates before it is saved. */
export const SCOP_DE_TEST: ScopFormula = { L: 2000, l: 1600, H: 350 }

/**
 * A parser with everything switched off except `+ - * / ( )` and the six
 * functions the spec allows.
 *
 * `eval()` and `new Function()` are forbidden (CLAUDE.md), so this is the only
 * path by which a user-authored string becomes a number. Constants are cleared
 * too: a formula that silently used PI would be a formula nobody could audit.
 */
function creeazaParser(): Parser {
  const parser = new Parser({
    allowMemberAccess: false,
    operators: {
      add: true,
      subtract: true,
      multiply: true,
      divide: true,
      min: true,
      max: true,
      ceil: true,
      floor: true,
      round: true,
      sqrt: true,

      power: false,
      remainder: false,
      factorial: false,
      logical: false,
      comparison: false,
      concatenate: false,
      conditional: false,
      assignment: false,
      fndef: false,
      in: false,
      random: false,
      length: false,
      abs: false,
      trunc: false,
      exp: false,
      log: false,
      ln: false,
      lg: false,
      log10: false,
      log2: false,
      log1p: false,
      expm1: false,
      cbrt: false,
      sign: false,
      sin: false,
      cos: false,
      tan: false,
      asin: false,
      acos: false,
      atan: false,
      sinh: false,
      cosh: false,
      tanh: false,
      asinh: false,
      acosh: false,
      atanh: false,
    },
  })

  const permise = new Set<string>(['min', 'max', 'ceil', 'floor', 'round', 'sqrt'])
  for (const nume of Object.keys(parser.functions)) {
    if (!permise.has(nume)) delete parser.functions[nume]
  }
  for (const nume of Object.keys(parser.consts)) {
    delete parser.consts[nume]
  }

  return parser
}

const parser = creeazaParser()

/** Matches a bare L, l or H. The `l` inside `floor` is not a match. */
const REGEX_VARIABILA = /\b[LlH]\b/g

/** A dimension without H simply does not define it — referencing it then fails. */
function valoriDinScop(scop: ScopFormula): Record<string, number> {
  const valori: Record<string, number> = { L: scop.L, l: scop.l }
  if (scop.H !== null) valori['H'] = scop.H
  return valori
}

export interface FormulaValidata {
  formula: string
  variabile: readonly VariabilaPermisa[]
  /** true when the formula references H, so a dimension without one is invalid */
  foloseteInaltime: boolean
}

/**
 * Parses a formula and proves it evaluates. Called when a recipe is saved, not
 * when a bon is calculated — a broken formula must never reach production.
 */
export function valideazaFormula(formula: string, nrLinie?: number): FormulaValidata {
  const text = formula.trim()
  if (text === '') {
    throw new EroareFormulaInvalida(formula, 'formula este goală', nrLinie)
  }

  let expresie
  try {
    expresie = parser.parse(text)
  } catch (err) {
    throw new EroareFormulaInvalida(formula, (err as Error).message, nrLinie)
  }

  const permise = new Set<string>(VARIABILE_PERMISE)
  const folosite = expresie.variables({ withMembers: false })
  const nepermise = folosite.filter((v) => !permise.has(v))
  if (nepermise.length > 0) {
    throw new EroareVariabilaNecunoscuta(formula, nepermise, nrLinie)
  }

  // Prove it runs. A formula that only fails at bon time is a formula that
  // fails in front of the operator.
  let rezultat: number
  try {
    rezultat = expresie.evaluate(valoriDinScop(SCOP_DE_TEST)) as number
  } catch (err) {
    throw new EroareFormulaInvalida(formula, (err as Error).message, nrLinie)
  }
  if (typeof rezultat !== 'number' || !Number.isFinite(rezultat)) {
    throw new EroareFormulaInvalida(
      formula,
      'nu produce un număr finit pe valorile de test (2000 × 1600 × 350)',
      nrLinie,
    )
  }

  return {
    formula: text,
    variabile: folosite as VariabilaPermisa[],
    foloseteInaltime: folosite.includes('H'),
  }
}

export interface RezultatFormula {
  valoare: Dec
  /** the formula with values substituted, stored for audit */
  expresieEvaluata: string
  /** true when the result was NaN or Infinity — the caller decides how to fail */
  esteNumar: boolean
}

/**
 * Significant digits kept when crossing from IEEE double to Decimal.
 *
 * A double carries 15–17 significant digits, and the last two are noise:
 * `2*(2000+1600)/1000*0.10*0.025` evaluates to 0.018000000000000002, not 0.018.
 * Truncating to 15 strips the noise deterministically. Recipe quantities land in
 * `numeric(18,6)` and are exported at 3 decimals, so nothing real is lost.
 */
const CIFRE_SEMNIFICATIVE = 15

/**
 * Evaluates a formula against one dimension.
 *
 * Note the precision boundary: expr-eval works in IEEE doubles, and the spec
 * mandates expr-eval. This is the only float arithmetic in the system. The
 * result is normalised and handed to Decimal here; everything downstream —
 * waste, product quantity, aggregation — is exact.
 */
export function evalueazaFormula(formula: string, scop: ScopFormula): RezultatFormula {
  const expresie = parser.parse(formula.trim())

  const valori = valoriDinScop(scop)
  const brut = expresie.evaluate(valori) as unknown

  const expresieEvaluata = formula.trim().replace(REGEX_VARIABILA, (nume) => {
    const v = valori[nume]
    return v === undefined ? nume : String(v)
  })

  if (typeof brut !== 'number' || !Number.isFinite(brut)) {
    return { valoare: new D(0), expresieEvaluata, esteNumar: false }
  }

  return {
    valoare: new D(brut === 0 ? 0 : brut.toPrecision(CIFRE_SEMNIFICATIVE)),
    expresieEvaluata,
    esteNumar: true,
  }
}
