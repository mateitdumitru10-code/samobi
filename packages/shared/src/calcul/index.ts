export * from './tipuri.js'
export * from './erori.js'
export {
  valideazaFormula,
  evalueazaFormula,
  VARIABILE_PERMISE,
  SCOP_DE_TEST,
  type FormulaValidata,
  type RezultatFormula,
  type ScopFormula,
  type VariabilaPermisa,
} from './formula.js'
// The decimal type itself: anything comparing or adding quantities outside the
// engine has to do it the same way, never through a float.
export { D, catreString, type Dec } from './decimal.js'
export {
  calculeazaConsumuri,
  cantitatiPeLinie,
  ZECIMALE_EXPORT,
  type CantitateLinie,
} from './calculeaza.js'
