/**
 * Shapes mirror the tables in SPEC.md §3, but the engine is deliberately
 * decoupled from Drizzle: it takes plain data so it can be tested, and reused,
 * without a database.
 *
 * Every quantity is a string. Postgres stores `numeric(18,6)`; JavaScript
 * `number` cannot hold that faithfully (CLAUDE.md, "Numere").
 */

export type ModCalcul = 'fixa' | 'formula' | 'tabel'

/** Where a quantity came from. Mirrors `production_order_line.sursa`. */
export type SursaCantitate = 'fixa' | 'formula' | 'tabel' | 'override' | 'manual'

export interface Dimensiune {
  id: string
  /** e.g. '2000x1600' */
  cod: string
  /** millimetres */
  lungime: string
  /** millimetres */
  latime: string
  /** millimetres; null when the model does not use H */
  inaltime: string | null
}

/** A row of `recipe_line_dimension`: a table-mode value, or a manual override. */
export interface ValoarePeDimensiune {
  dimensiuneId: string
  cantitate: string
  esteOverride: boolean
}

export interface LinieReteta {
  id: string
  nrLinie: number
  grup: string
  /** null when `esteVariabil` — the article is chosen when the bon is created */
  codSaga: string | null
  esteVariabil: boolean
  categorieVariabila: string | null
  um: string
  modCalcul: ModCalcul
  cantitateFixa: string | null
  formula: string | null
  /** percentage, e.g. '8' means 8% */
  procentPierderi: string
  gestiuneDescarcare: string | null
  valoriPeDimensiuni: readonly ValoarePeDimensiune[]
}

export interface Reteta {
  id: string
  modelId: string
  versiune: number
  linii: readonly LinieReteta[]
}

export interface IntrareCalcul {
  reteta: Reteta
  dimensiune: Dimensiune
  /** how many finished products the bon covers */
  cantitateProdus: string
  /** recipe line id → chosen SAGA article, for lines with `esteVariabil` */
  alegeriMateriale: ReadonlyMap<string, string>
}

/** One recipe line's contribution to a consumption row. Kept for audit. */
export interface Contributie {
  linieId: string
  nrLinie: number
  grup: string
  sursa: SursaCantitate
  /** the expression with L, l and H substituted; null unless `sursa === 'formula'` */
  formulaEvaluata: string | null
  procentPierderi: string
  cantitateNeta: string
  cantitateBruta: string
}

/** One row of the export: a single article, aggregated across recipe lines. */
export interface ConsumLine {
  codSaga: string
  um: string
  gestiuneDescarcare: string | null
  /** full precision, before waste */
  cantitateNeta: string
  /** full precision, after waste and product quantity */
  cantitateBruta: string
  /** `cantitateBruta` at 3 decimals — the value that goes into the XLSX */
  cantitateBrutaRotunjita: string
  /** the single source, or 'agregat' when several lines merged into this row */
  sursa: SursaCantitate | 'agregat'
  contributii: readonly Contributie[]
}

export interface RezultatCalcul {
  retetaId: string
  versiuneReteta: number
  dimensiuneId: string
  cantitateProdus: string
  linii: readonly ConsumLine[]
}
