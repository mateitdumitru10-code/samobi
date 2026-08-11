import { z } from 'zod'

import { STATUSURI_BON } from '../db/schema.js'

export const schemaStatusBon = z.enum(STATUSURI_BON)

const cantitate = z
  .string()
  .trim()
  .refine((v) => v !== '' && Number.isFinite(Number(v)) && Number(v) > 0, {
    message: 'Cantitatea trebuie să fie un număr mai mare ca 0.',
  })

export const schemaPrevizualizare = z.object({
  modelId: z.string().uuid(),
  dimensiuneId: z.string().uuid(),
  cantitate,
  /** recipe line id → chosen SAGA article, for the variable lines */
  alegeri: z.record(z.string().uuid(), z.string().trim().min(1)).default({}),
  /**
   * recipe line id → quantity typed instead of the recipe's, for the variable
   * lines. The recipe records what one run consumed; the next roll is wider.
   */
  cantitati: z.record(z.string().uuid(), cantitate).default({}),
})
export type Previzualizare = z.infer<typeof schemaPrevizualizare>

export const schemaBonNou = schemaPrevizualizare.extend({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data are formatul AAAA-LL-ZZ.'),
  nrDoc: z.string().trim().max(40).nullable().optional(),
  gestiuneProdus: z.string().trim().min(1, 'Alege gestiunea de produs finit.').max(60),
})
export type BonNou = z.infer<typeof schemaBonNou>

export const schemaExport = z.object({
  bonIds: z.array(z.string().uuid()).min(1, 'Alege cel puțin un bon.'),
  /** Required to export a bon that already went to SAGA once. */
  confirmaReexport: z.boolean().default(false),
})
export type CerereExport = z.infer<typeof schemaExport>
