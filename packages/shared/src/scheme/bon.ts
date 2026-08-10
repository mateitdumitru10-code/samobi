import { z } from 'zod'

import { STATUSURI_BON } from '../db/schema.js'

export const schemaStatusBon = z.enum(STATUSURI_BON)

const cantitate = z
  .string()
  .trim()
  .refine((v) => v !== '' && Number.isFinite(Number(v)) && Number(v) > 0, {
    message: 'Cantitatea trebuie să fie un număr mai mare ca 0.',
  })

/**
 * A made-to-order measurement: whole millimetres.
 *
 * Furniture is not cut at half a millimetre, and refusing the decimal here
 * removes an entire class of ambiguity — including whether the comma the
 * operator typed meant a decimal point or a thumb on the wrong key.
 */
const milimetri = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,4}$/, 'Milimetri întregi, ex. 2150.')

export const schemaDimensiuneLaComanda = z.object({
  lungime: milimetri,
  latime: milimetri,
  inaltime: milimetri.nullable().optional(),
})
export type DimensiuneLaComanda = z.infer<typeof schemaDimensiuneLaComanda>

export const schemaPrevizualizare = z
  .object({
    modelId: z.string().uuid(),
    /** Omitted exactly when `dimensiune` carries a made-to-order size. */
    dimensiuneId: z.string().uuid().optional(),
    dimensiune: schemaDimensiuneLaComanda.optional(),
    cantitate,
    /** recipe line id → chosen SAGA article, for the variable lines */
    alegeri: z.record(z.string().uuid(), z.string().trim().min(1)).default({}),
    /**
     * recipe line id → quantity typed by the operator, for `tabel` lines at a
     * size the recipe has no row for.
     */
    valoriManuale: z.record(z.string().uuid(), z.string().trim().min(1)).default({}),
  })
  .refine((v) => (v.dimensiuneId === undefined) !== (v.dimensiune === undefined), {
    message: 'Alege o dimensiune înregistrată sau dă una la comandă, nu amândouă.',
    path: ['dimensiuneId'],
  })
export type Previzualizare = z.infer<typeof schemaPrevizualizare>

export const schemaBonNou = z
  .object({
    modelId: z.string().uuid(),
    dimensiuneId: z.string().uuid().optional(),
    dimensiune: schemaDimensiuneLaComanda.optional(),
    cantitate,
    alegeri: z.record(z.string().uuid(), z.string().trim().min(1)).default({}),
    valoriManuale: z.record(z.string().uuid(), z.string().trim().min(1)).default({}),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data are formatul AAAA-LL-ZZ.'),
    nrDoc: z.string().trim().max(40).nullable().optional(),
    gestiuneProdus: z.string().trim().min(1, 'Alege gestiunea de produs finit.').max(60),
    /** Overrides the model's made-to-order article, for a one-off the accountant pre-created. */
    codSagaProdus: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine((v) => (v.dimensiuneId === undefined) !== (v.dimensiune === undefined), {
    message: 'Alege o dimensiune înregistrată sau dă una la comandă, nu amândouă.',
    path: ['dimensiuneId'],
  })
export type BonNou = z.infer<typeof schemaBonNou>

export const schemaExport = z.object({
  bonIds: z.array(z.string().uuid()).min(1, 'Alege cel puțin un bon.'),
  /** Required to export a bon that already went to SAGA once. */
  confirmaReexport: z.boolean().default(false),
})
export type CerereExport = z.infer<typeof schemaExport>
