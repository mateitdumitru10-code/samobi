import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/**
 * Every table lives in `public`. The `auth` schema belongs to Supabase and is
 * never modified — `schemaFilter` in drizzle.config.ts keeps drizzle-kit from
 * touching it. It is declared here only so foreign keys can point at it.
 */
const authSchema = pgSchema('auth')

const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
})

/** Postgres `inet`. Drizzle has no builtin for it. */
const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
})

/**
 * All quantities and prices. Money and metres do not fit in a float, and the
 * whole point of this application is that the numbers match the accountant's.
 */
function cantitate(nume: string) {
  return numeric(nume, { precision: 18, scale: 6 })
}

const creatLa = () => timestamp('creat_la', { withTimezone: true }).notNull().defaultNow()

// ---------------------------------------------------------------------------
// Utilizatori
// ---------------------------------------------------------------------------

export const ROLURI = ['admin', 'tehnolog', 'operator', 'contabil'] as const
export type Rol = (typeof ROLURI)[number]

/**
 * Supabase Auth owns identities, passwords, sessions and invitations. This table
 * adds only what the application needs on top: a name and a role. Rows are
 * created by a trigger on auth.users — see the accompanying SQL migration.
 */
export const profile = pgTable(
  'profile',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    nume: text('nume').notNull(),
    rol: text('rol').notNull(),
    activ: boolean('activ').notNull().default(true),
    creatDe: uuid('creat_de').references((): AnyPgColumn => profile.id),
    creatLa: creatLa(),
  },
  (t) => [
    check('profile_rol_valid', sql`${t.rol} in ('admin', 'tehnolog', 'operator', 'contabil')`),
    check('profile_nume_nevid', sql`length(btrim(${t.nume})) > 0`),
    index('profile_rol_idx').on(t.rol),
  ],
).enableRLS()

// ---------------------------------------------------------------------------
// Nomenclator SAGA
// ---------------------------------------------------------------------------

export const TIPURI_ARTICOL = ['produs', 'materie_prima', 'marfa', 'altele'] as const
export type TipArticol = (typeof TIPURI_ARTICOL)[number]

/**
 * The SAGA article catalogue, refreshed from an XLSX export. One row per code.
 *
 * `cod_saga` is text and keeps its leading zeros ('00016024'). Treating it as a
 * number breaks the import back into SAGA.
 *
 * `um` holds SAGA's own unit string, warts and all — the export file must carry
 * exactly what SAGA expects. The real catalogue contains 90 distinct spellings,
 * including whitespace and typos, so `um_normalizat` carries our cleaned-up
 * version for validation and reporting. The two are deliberately separate.
 */
export const sagaArticle = pgTable(
  'saga_article',
  {
    codSaga: text('cod_saga').primaryKey(),
    denumire: text('denumire').notNull(),
    um: text('um').notNull(),
    umNormalizat: text('um_normalizat'),
    tip: text('tip').notNull(),
    /** the raw `den_tip` value from SAGA, kept because ours is a lossy mapping */
    tipSaga: text('tip_saga'),
    /** accounting account: 301 raw materials, 345 finished goods, 371 goods */
    cont: text('cont'),
    gestiuneImplicita: text('gestiune_implicita'),
    categorie: text('categorie'),
    pretReferinta: cantitate('pret_referinta'),
    /**
     * Stock on hand at the last import that carried it.
     *
     * A snapshot, not a running balance — the application never writes here, and
     * a procurement report says which import it is looking at rather than
     * pretending the figure is live.
     */
    stoc: cantitate('stoc'),
    /**
     * The unit price SAGA last used when this article was consumed on a bon.
     *
     * Kept apart from `pret_referinta`, which is the catalogue's weighted
     * average: they answer different questions, and the average is missing for
     * five sixths of the catalogue. Costing falls back to this one, and says so.
     */
    pretConsum: cantitate('pret_consum'),
    pretConsumLa: date('pret_consum_la'),
    activ: boolean('activ').notNull().default(true),
    sincronizatLa: timestamp('sincronizat_la', { withTimezone: true }),
  },
  (t) => [
    check('saga_article_tip_valid', sql`${t.tip} in ('produs', 'materie_prima', 'marfa', 'altele')`),
    check('saga_article_cod_nevid', sql`length(btrim(${t.codSaga})) > 0`),
    check('saga_article_pret_pozitiv', sql`${t.pretReferinta} is null or ${t.pretReferinta} >= 0`),
    index('saga_article_tip_idx').on(t.tip),
    index('saga_article_denumire_idx').on(t.denumire),
  ],
).enableRLS()

/** One row per nomenclature import, so a bad import can be traced. */
export const sagaSync = pgTable(
  'saga_sync',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rulatLa: timestamp('rulat_la', { withTimezone: true }).notNull().defaultNow(),
    rulatDe: uuid('rulat_de').references(() => profile.id),
    articoleNoi: integer('articole_noi').notNull().default(0),
    articoleModificate: integer('articole_modificate').notNull().default(0),
    articoleDisparute: integer('articole_disparute').notNull().default(0),
    fisierNume: text('fisier_nume'),
  },
  (t) => [index('saga_sync_rulat_la_idx').on(t.rulatLa)],
).enableRLS()

/**
 * Materials named in a recipe that have no counterpart in the catalogue.
 * They block the export of any bon that uses them.
 */
export const unmappedMaterial = pgTable(
  'unmapped_material',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    denumireExterna: text('denumire_externa').notNull(),
    sugestieCodSaga: text('sugestie_cod_saga').references(() => sagaArticle.codSaga),
    /**
     * Candidates worked out when the material was queued, with the evidence
     * behind them: how often the article appears in that product's bons and how
     * much of it goes into one unit. Stored rather than recomputed, so the
     * screen does not have to re-read a 200.000-line production export.
     */
    sugestii: jsonb('sugestii'),
    rezolvat: boolean('rezolvat').notNull().default(false),
    rezolvatDe: uuid('rezolvat_de').references(() => profile.id),
    rezolvatLa: timestamp('rezolvat_la', { withTimezone: true }),
    creatLa: creatLa(),
  },
  (t) => [
    unique('unmapped_material_denumire_unic').on(t.denumireExterna),
    check(
      'unmapped_material_rezolvat_coerent',
      sql`(${t.rezolvat} = false and ${t.rezolvatLa} is null) or (${t.rezolvat} = true and ${t.rezolvatLa} is not null)`,
    ),
  ],
).enableRLS()

/**
 * Where an unmapped material actually appears.
 *
 * A name like HSURUB 4/25 shows up on a dozen sheets, each with its own line
 * number, unit and quantity. Without these rows, resolving the name records a
 * decision and changes nothing — the recipe line still is not there. With them,
 * one decision completes every recipe that was waiting on it.
 */
export const unmappedMaterialOcurenta = pgTable(
  'unmapped_material_ocurenta',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unmappedMaterialId: uuid('unmapped_material_id')
      .notNull()
      .references(() => unmappedMaterial.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    nrLinie: integer('nr_linie').notNull(),
    grup: text('grup').notNull(),
    um: text('um').notNull(),
    cantitate: cantitate('cantitate').notNull(),
    /** True once the recipe line has been created from this occurrence. */
    aplicat: boolean('aplicat').notNull().default(false),
    creatLa: creatLa(),
  },
  (t) => [
    unique('unmapped_ocurenta_unic').on(t.recipeId, t.nrLinie),
    index('unmapped_ocurenta_material_idx').on(t.unmappedMaterialId),
  ],
).enableRLS()

// ---------------------------------------------------------------------------
// Modele si dimensiuni
// ---------------------------------------------------------------------------

export const FAMILII = ['PAT', 'CANAPEA', 'COLTAR', 'SALTEA', 'ALTELE'] as const
export type Familie = (typeof FAMILII)[number]

export const model = pgTable(
  'model',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cod: text('cod').notNull().unique(),
    denumire: text('denumire').notNull(),
    familie: text('familie').notNull(),
    umProdus: text('um_produs').notNull().default('BUC'),
    activ: boolean('activ').notNull().default(true),
    creatDe: uuid('creat_de').references(() => profile.id),
    creatLa: creatLa(),
    modificatLa: timestamp('modificat_la', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'model_familie_valida',
      sql`${t.familie} in ('PAT', 'CANAPEA', 'COLTAR', 'SALTEA', 'ALTELE')`,
    ),
    check('model_cod_nevid', sql`length(btrim(${t.cod})) > 0`),
  ],
).enableRLS()

/**
 * Dimensions are in millimetres. Formulas convert explicitly to the material's
 * unit (`/1000` for metres), which is why the column names say so.
 */
export const dimension = pgTable(
  'dimension',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => model.id),
    cod: text('cod').notNull(),
    lungime: cantitate('lungime').notNull(),
    latime: cantitate('latime').notNull(),
    inaltime: cantitate('inaltime'),
    codSagaProdus: text('cod_saga_produs').references(() => sagaArticle.codSaga),
    activ: boolean('activ').notNull().default(true),
    creatLa: creatLa(),
  },
  (t) => [
    unique('dimension_model_cod_unic').on(t.modelId, t.cod),
    check('dimension_lungime_pozitiva', sql`${t.lungime} > 0`),
    check('dimension_latime_pozitiva', sql`${t.latime} > 0`),
    check('dimension_inaltime_pozitiva', sql`${t.inaltime} is null or ${t.inaltime} > 0`),
    index('dimension_model_idx').on(t.modelId),
  ],
).enableRLS()

// ---------------------------------------------------------------------------
// Retete
// ---------------------------------------------------------------------------

export const STATUSURI_RETETA = ['draft', 'in_aprobare', 'activa', 'arhivata'] as const
export type StatusReteta = (typeof STATUSURI_RETETA)[number]

export const recipe = pgTable(
  'recipe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => model.id),
    versiune: integer('versiune').notNull(),
    status: text('status').notNull().default('draft'),
    valabilDeLa: date('valabil_de_la'),
    aprobatDe: uuid('aprobat_de').references(() => profile.id),
    aprobatLa: timestamp('aprobat_la', { withTimezone: true }),
    /** optimistic locking for the recipe grid; a conflict returns 409 */
    lockVersion: integer('lock_version').notNull().default(0),
    creatDe: uuid('creat_de').references(() => profile.id),
    creatLa: creatLa(),
  },
  (t) => [
    unique('recipe_model_versiune_unic').on(t.modelId, t.versiune),
    // A model has at most one active recipe. Enforced here rather than in code,
    // because two active recipes would make every bon ambiguous.
    uniqueIndex('one_active_recipe_per_model')
      .on(t.modelId)
      .where(sql`status = 'activa'`),
    check(
      'recipe_status_valid',
      sql`${t.status} in ('draft', 'in_aprobare', 'activa', 'arhivata')`,
    ),
    check('recipe_versiune_pozitiva', sql`${t.versiune} > 0`),
    // A tehnolog cannot approve their own recipe (SPEC §3).
    check('recipe_aprobare_nu_de_autor', sql`${t.aprobatDe} is null or ${t.aprobatDe} <> ${t.creatDe}`),
    check(
      'recipe_aprobare_coerenta',
      sql`(${t.aprobatDe} is null and ${t.aprobatLa} is null) or (${t.aprobatDe} is not null and ${t.aprobatLa} is not null)`,
    ),
  ],
).enableRLS()

export const MODURI_CALCUL = ['fixa', 'formula', 'tabel'] as const
export type ModCalculDb = (typeof MODURI_CALCUL)[number]

export const GRUPURI = ['STRUCTURA', 'TAPITERIE', 'SPUMA', 'ACCESORII', 'AMBALAJ'] as const

export const recipeLine = pgTable(
  'recipe_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    nrLinie: integer('nr_linie').notNull(),
    grup: text('grup').notNull(),
    /** null exactly when `este_variabil` — the article is picked per bon */
    codSaga: text('cod_saga').references(() => sagaArticle.codSaga),
    esteVariabil: boolean('este_variabil').notNull().default(false),
    categorieVariabila: text('categorie_variabila'),
    um: text('um').notNull(),
    modCalcul: text('mod_calcul').notNull(),
    cantitateFixa: cantitate('cantitate_fixa'),
    formula: text('formula'),
    procentPierderi: cantitate('procent_pierderi').notNull().default('0'),
    gestiuneDescarcare: text('gestiune_descarcare'),
    obligatoriu: boolean('obligatoriu').notNull().default(true),
    observatii: text('observatii'),
  },
  (t) => [
    unique('recipe_line_nr_unic').on(t.recipeId, t.nrLinie),
    check('recipe_line_mod_valid', sql`${t.modCalcul} in ('fixa', 'formula', 'tabel')`),
    check('recipe_line_nr_pozitiv', sql`${t.nrLinie} > 0`),
    check('recipe_line_pierderi_valide', sql`${t.procentPierderi} >= 0 and ${t.procentPierderi} < 100`),
    // A variable line has no code and must say what category to pick from.
    // A fixed line must name its article. Neither is optional.
    check(
      'recipe_line_variabil_coerent',
      sql`(${t.esteVariabil} = true and ${t.codSaga} is null and ${t.categorieVariabila} is not null)
          or (${t.esteVariabil} = false and ${t.codSaga} is not null)`,
    ),
    // Each mode requires its own field. 'tabel' is validated against
    // recipe_line_dimension at calculation time, not here.
    check(
      'recipe_line_mod_coerent',
      sql`(${t.modCalcul} = 'fixa' and ${t.cantitateFixa} is not null)
          or (${t.modCalcul} = 'formula' and ${t.formula} is not null and length(btrim(${t.formula})) > 0)
          or ${t.modCalcul} = 'tabel'`,
    ),
    check('recipe_line_cantitate_fixa_pozitiva', sql`${t.cantitateFixa} is null or ${t.cantitateFixa} >= 0`),
    index('recipe_line_recipe_idx').on(t.recipeId),
  ],
).enableRLS()

/** Table-mode quantities, and manual overrides. Same table, distinguished by a flag. */
export const recipeLineDimension = pgTable(
  'recipe_line_dimension',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeLineId: uuid('recipe_line_id')
      .notNull()
      .references(() => recipeLine.id, { onDelete: 'cascade' }),
    dimensionId: uuid('dimension_id')
      .notNull()
      .references(() => dimension.id),
    cantitate: cantitate('cantitate').notNull(),
    esteOverride: boolean('este_override').notNull().default(false),
    motiv: text('motiv'),
    setatDe: uuid('setat_de').references(() => profile.id),
    setatLa: timestamp('setat_la', { withTimezone: true }),
  },
  (t) => [
    unique('recipe_line_dimension_unic').on(t.recipeLineId, t.dimensionId),
    check('recipe_line_dimension_cantitate_pozitiva', sql`${t.cantitate} >= 0`),
    // An override without an author and a reason is an override nobody can defend.
    check(
      'recipe_line_dimension_override_motivat',
      sql`${t.esteOverride} = false
          or (${t.motiv} is not null and length(btrim(${t.motiv})) > 0 and ${t.setatDe} is not null and ${t.setatLa} is not null)`,
    ),
    index('recipe_line_dimension_linie_idx').on(t.recipeLineId),
  ],
).enableRLS()

export const recipeLineAlternative = pgTable(
  'recipe_line_alternative',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeLineId: uuid('recipe_line_id')
      .notNull()
      .references(() => recipeLine.id, { onDelete: 'cascade' }),
    codSaga: text('cod_saga')
      .notNull()
      .references(() => sagaArticle.codSaga),
    prioritate: integer('prioritate').notNull().default(1),
  },
  (t) => [
    unique('recipe_line_alternative_unic').on(t.recipeLineId, t.codSaga),
    check('recipe_line_alternative_prioritate_pozitiva', sql`${t.prioritate} > 0`),
  ],
).enableRLS()

// ---------------------------------------------------------------------------
// Bonuri si export
// ---------------------------------------------------------------------------

export const STATUSURI_BON = ['draft', 'calculat', 'exportat', 'anulat'] as const
export type StatusBon = (typeof STATUSURI_BON)[number]

export const exportBatch = pgTable(
  'export_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generatDe: uuid('generat_de').references(() => profile.id),
    generatLa: timestamp('generat_la', { withTimezone: true }).notNull().defaultNow(),
    hashContinut: text('hash_continut').notNull(),
    nrBonuri: integer('nr_bonuri').notNull(),
    nrLinii: integer('nr_linii').notNull(),
    /** path inside the private Supabase Storage bucket */
    storagePath: text('storage_path'),
  },
  (t) => [
    check('export_batch_nr_bonuri_pozitiv', sql`${t.nrBonuri} > 0`),
    check('export_batch_nr_linii_pozitiv', sql`${t.nrLinii} > 0`),
    index('export_batch_generat_la_idx').on(t.generatLa),
  ],
).enableRLS()

/**
 * A bon references `recipe_id`, not `model_id`. A bon from July stays exactly
 * reproducible even after the recipe changes in August.
 */
export const productionOrder = pgTable(
  'production_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nrDoc: text('nr_doc'),
    data: date('data').notNull(),
    gestiuneProdus: text('gestiune_produs').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => model.id),
    dimensionId: uuid('dimension_id')
      .notNull()
      .references(() => dimension.id),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipe.id),
    codSagaProdus: text('cod_saga_produs')
      .notNull()
      .references(() => sagaArticle.codSaga),
    cantitate: cantitate('cantitate').notNull(),
    pretPrestabilit: cantitate('pret_prestabilit'),
    status: text('status').notNull().default('draft'),
    exportId: uuid('export_id').references(() => exportBatch.id),
    creatDe: uuid('creat_de').references(() => profile.id),
    creatLa: creatLa(),
  },
  (t) => [
    check(
      'production_order_status_valid',
      sql`${t.status} in ('draft', 'calculat', 'exportat', 'anulat')`,
    ),
    check('production_order_cantitate_pozitiva', sql`${t.cantitate} > 0`),
    check('production_order_pret_pozitiv', sql`${t.pretPrestabilit} is null or ${t.pretPrestabilit} >= 0`),
    // Exported means exported: the batch it belongs to is not optional.
    check(
      'production_order_export_coerent',
      sql`(${t.status} = 'exportat' and ${t.exportId} is not null)
          or (${t.status} <> 'exportat' and ${t.exportId} is null)`,
    ),
    index('production_order_status_idx').on(t.status),
    index('production_order_data_idx').on(t.data),
    index('production_order_export_idx').on(t.exportId),
  ],
).enableRLS()

export const SURSE_CANTITATE = ['fixa', 'formula', 'tabel', 'override', 'manual', 'agregat'] as const

export const productionOrderLine = pgTable(
  'production_order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productionOrderId: uuid('production_order_id')
      .notNull()
      .references(() => productionOrder.id, { onDelete: 'cascade' }),
    codSaga: text('cod_saga')
      .notNull()
      .references(() => sagaArticle.codSaga),
    um: text('um').notNull(),
    cantitateNeta: cantitate('cantitate_neta').notNull(),
    cantitateBruta: cantitate('cantitate_bruta').notNull(),
    sursa: text('sursa').notNull(),
    /** the expression with values substituted, kept for audit */
    formulaEvaluata: text('formula_evaluata'),
    gestiuneDescarcare: text('gestiune_descarcare'),
  },
  (t) => [
    unique('production_order_line_articol_unic').on(t.productionOrderId, t.codSaga),
    check(
      'production_order_line_sursa_valida',
      sql`${t.sursa} in ('fixa', 'formula', 'tabel', 'override', 'manual', 'agregat')`,
    ),
    check('production_order_line_neta_pozitiva', sql`${t.cantitateNeta} >= 0`),
    // Waste can only add. Gross below net means the calculation ran backwards.
    check('production_order_line_bruta_peste_neta', sql`${t.cantitateBruta} >= ${t.cantitateNeta}`),
    index('production_order_line_bon_idx').on(t.productionOrderId),
  ],
).enableRLS()

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Append-only, enforced in the database: the accompanying migration revokes
 * UPDATE and DELETE and leaves an INSERT-only RLS policy. An audit trail that
 * the application can rewrite is not an audit trail.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    /**
     * Deliberately not a foreign key. An audit trail has to outlive what it
     * describes; with a FK, the first logged action made the account impossible
     * to delete and `auth.admin.deleteUser` reported success while deleting
     * nothing.
     */
    userId: uuid('user_id'),
    entitate: text('entitate').notNull(),
    entitateId: text('entitate_id').notNull(),
    actiune: text('actiune').notNull(),
    diff: jsonb('diff'),
    ip: inet('ip'),
    creatLa: creatLa(),
  },
  (t) => [
    index('audit_log_entitate_idx').on(t.entitate, t.entitateId),
    index('audit_log_creat_la_idx').on(t.creatLa),
    index('audit_log_user_idx').on(t.userId),
  ],
).enableRLS()
