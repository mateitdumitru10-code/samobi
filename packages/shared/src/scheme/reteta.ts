import { z } from 'zod'

import { FAMILII, GRUPURI, MODURI_CALCUL, STATUSURI_RETETA } from '../db/schema.js'

/**
 * Shapes shared by API and web. They mirror the CHECK constraints in the
 * database on purpose: the database is the last word, but the user deserves to
 * hear about a mistake in Romanian and before the round trip.
 */

/** Quantities travel as strings. `numeric(18,6)` does not survive a float. */
const zecimal = (mesaj: string) =>
  z
    .string()
    .trim()
    .refine((v) => v !== '' && Number.isFinite(Number(v)), { message: mesaj })

const zecimalPozitiv = (mesaj: string) =>
  zecimal(mesaj).refine((v) => Number(v) > 0, { message: `${mesaj} Trebuie să fie mai mare ca 0.` })

export const schemaFamilie = z.enum(FAMILII)
export const schemaModCalcul = z.enum(MODURI_CALCUL)
export const schemaStatusReteta = z.enum(STATUSURI_RETETA)
export const schemaGrup = z.enum(GRUPURI)

// ---------------------------------------------------------------------------
// Modele
// ---------------------------------------------------------------------------

export const schemaModel = z.object({
  cod: z
    .string()
    .trim()
    .min(2, 'Codul are minim 2 caractere.')
    .max(40)
    .regex(/^[A-Z0-9-]+$/, 'Codul acceptă doar litere mari, cifre și cratimă. Exemplu: PAT-DAVID'),
  denumire: z.string().trim().min(2, 'Denumirea are minim 2 caractere.').max(120),
  familie: schemaFamilie,
  umProdus: z.string().trim().min(1).max(10).default('BUC'),
})
export type ModelNou = z.infer<typeof schemaModel>

export const schemaModificareModel = schemaModel.partial().extend({
  activ: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Dimensiuni
// ---------------------------------------------------------------------------

export const schemaDimensiuneBaza = z.object({
  cod: z.string().trim().min(1, 'Codul dimensiunii este obligatoriu.').max(40),
  /** millimetres, always */
  lungime: zecimalPozitiv('Lungimea trebuie să fie un număr în milimetri.'),
  latime: zecimalPozitiv('Lățimea trebuie să fie un număr în milimetri.'),
  inaltime: zecimalPozitiv('Înălțimea trebuie să fie un număr în milimetri.').nullable().optional(),
  codSagaProdus: z.string().trim().max(20).nullable().optional(),
})

export const schemaDimensiune = schemaDimensiuneBaza
  .refine(
    (d) => Number(d.lungime) >= 100 && Number(d.latime) >= 100,
    // 2.0 instead of 2000 is the mistake people actually make, and a formula
    // dividing by 1000 turns it into a silently tiny consumption.
    { message: 'Dimensiunile se scriu în milimetri: 2000, nu 2 sau 200.', path: ['lungime'] },
  )
export type DimensiuneNoua = z.infer<typeof schemaDimensiune>

// ---------------------------------------------------------------------------
// Rețete
// ---------------------------------------------------------------------------

export const schemaValoarePeDimensiune = z
  .object({
    dimensiuneId: z.string().uuid(),
    cantitate: zecimal('Cantitatea trebuie să fie un număr.'),
    esteOverride: z.boolean().default(false),
    motiv: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => !v.esteOverride || (v.motiv !== null && v.motiv !== undefined && v.motiv !== ''), {
    // An override nobody explained is an override nobody can defend later.
    message: 'Un override are nevoie de motiv.',
    path: ['motiv'],
  })

export const schemaLinieReteta = z
  .object({
    /** present when editing an existing line, absent when adding one */
    id: z.string().uuid().optional(),
    nrLinie: z.number().int().positive(),
    grup: z.string().trim().min(1, 'Alege grupul.').max(40),
    codSaga: z.string().trim().max(20).nullable().default(null),
    esteVariabil: z.boolean().default(false),
    categorieVariabila: z.string().trim().max(40).nullable().default(null),
    um: z.string().trim().min(1, 'UM este obligatorie.').max(20),
    modCalcul: schemaModCalcul,
    cantitateFixa: zecimal('Cantitatea fixă trebuie să fie un număr.').nullable().default(null),
    formula: z.string().trim().max(500).nullable().default(null),
    procentPierderi: zecimal('Procentul de pierderi trebuie să fie un număr.').default('0'),
    gestiuneDescarcare: z.string().trim().max(60).nullable().default(null),
    obligatoriu: z.boolean().default(true),
    observatii: z.string().trim().max(300).nullable().default(null),
    valoriPeDimensiuni: z.array(schemaValoarePeDimensiune).default([]),
  })
  .refine((l) => Number(l.procentPierderi) >= 0 && Number(l.procentPierderi) < 100, {
    message: 'Pierderile sunt între 0 și 99,99%.',
    path: ['procentPierderi'],
  })
  .refine((l) => (l.esteVariabil ? l.codSaga === null : l.codSaga !== null), {
    message: 'O linie variabilă nu are cod SAGA; una fixă trebuie să aibă unul.',
    path: ['codSaga'],
  })
  .refine((l) => !l.esteVariabil || (l.categorieVariabila ?? '') !== '', {
    message: 'Alege categoria din care se va lua materialul.',
    path: ['categorieVariabila'],
  })
  .refine((l) => l.modCalcul !== 'fixa' || l.cantitateFixa !== null, {
    message: 'Modul „fixa" cere o cantitate.',
    path: ['cantitateFixa'],
  })
  .refine((l) => l.modCalcul !== 'formula' || (l.formula ?? '') !== '', {
    message: 'Modul „formula" cere o formulă.',
    path: ['formula'],
  })
export type LinieRetetaIntrare = z.infer<typeof schemaLinieReteta>

export const schemaSalvareReteta = z.object({
  /** What the client believed the version was. A mismatch is a 409. */
  lockVersion: z.number().int().min(0),
  linii: z.array(schemaLinieReteta),
})
export type SalvareReteta = z.infer<typeof schemaSalvareReteta>

export const schemaValidareFormula = z.object({
  formula: z.string().trim().min(1, 'Scrie o formulă.').max(500),
  /** When given, the response also carries the value on that dimension. */
  dimensiuneId: z.string().uuid().optional(),
})

export interface RezultatValidareFormula {
  valida: boolean
  mesaj: string | null
  variabile: string[]
  previzualizare: {
    dimensiune: string
    expresieEvaluata: string
    valoare: string
  } | null
}
