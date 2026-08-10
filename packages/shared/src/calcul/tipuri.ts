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

/**
 * The size a bon is calculated at.
 *
 * `id` is null when the customer asked for a size nobody registered. That is
 * the whole distinction: a registered dimension has table values and overrides
 * hanging off its id, a made-to-order one has nothing but its measurements.
 */
export interface DimensiuneCeruta {
  id: string | null
  /** e.g. '2000x1600', or '2150×1450×400' for a made-to-order size */
  cod: string
  /** millimetres */
  lungime: string
  /** millimetres */
  latime: string
  /** millimetres; null when the model does not use H */
  inaltime: string | null
}

/** A registered dimension: a row of `dimension`. */
export interface Dimensiune extends DimensiuneCeruta {
  id: string
}

/**
 * The envelope a model may be built in, declared by the tehnolog.
 *
 * A formula is a claim about a range, not about a point. Outside the declared
 * one the engine refuses rather than extrapolating: the failures are silent and
 * expensive — a bed short half its PAL because a formula was carried past a
 * panel boundary nobody modelled.
 */
export interface IntervalDimensiuni {
  lungimeMin: string
  lungimeMax: string
  latimeMin: string
  latimeMax: string
  inaltimeMin: string | null
  inaltimeMax: string | null
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
  dimensiune: DimensiuneCeruta
  /** how many finished products the bon covers */
  cantitateProdus: string
  /** recipe line id → chosen SAGA article, for lines with `esteVariabil` */
  alegeriMateriale: ReadonlyMap<string, string>
  /**
   * The range the model may be built in. Required for a made-to-order size,
   * ignored for a registered one — a registered dimension is itself the proof
   * that somebody decided the model can be built that way.
   */
  interval?: IntervalDimensiuni | null | undefined
  /**
   * recipe line id → quantity typed by the person issuing the bon.
   *
   * Only `tabel` lines at a made-to-order size read this. Upholstery metreage
   * does not follow from geometry (SPEC §2), so at an unregistered size the
   * engine asks instead of guessing.
   */
  valoriManuale?: ReadonlyMap<string, string> | undefined
}

/** One recipe line's contribution to a consumption row. Kept for audit. */
export interface Contributie {
  linieId: string
  nrLinie: number
  grup: string
  sursa: SursaCantitate
  /** the expression with L, l and H substituted; null unless `sursa === 'formula'` */
  formulaEvaluata: string | null
  /** the formula as written, so the bon stands alone once the recipe moves on */
  formula: string | null
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
  /** null for a made-to-order size */
  dimensiuneId: string | null
  /** The measurements actually used, snapshotted so the bon stays explicable. */
  dimensiune: DimensiuneCeruta
  cantitateProdus: string
  linii: readonly ConsumLine[]
}
