import { Decimal } from 'decimal.js'

/**
 * A private Decimal constructor so the engine's precision settings never leak
 * into, or get clobbered by, anything else that imports decimal.js.
 *
 * toExpNeg/toExpPos are pushed far out because these values end up in an XLSX
 * cell and in the database as `numeric(18,6)`; exponential notation there would
 * be a defect.
 */
export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
})

export type Dec = InstanceType<typeof D>

/** Quantities cross module boundaries as strings, never as `number`. */
export function catreString(valoare: Dec): string {
  return valoare.toString()
}
