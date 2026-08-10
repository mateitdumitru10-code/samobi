import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

import { FISE, type Fisa } from './fise.js'

/**
 * Recipes transcribed into JSON, one file per batch of scanned sheets.
 *
 * They are validated on the way in rather than trusted. A transcription that
 * lost a unit or turned a quantity into prose should fail here, loudly, and not
 * three steps later as a recipe line nobody can explain.
 */

const schemaLinie = z.object({
  nr: z.number().int().positive(),
  denumire: z.string().trim().min(1),
  um: z.string().trim().min(1),
  cantitate: z
    .string()
    .trim()
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, {
      message: 'cantitatea trebuie să fie un număr mai mare ca 0',
    }),
  grup: z.enum(['STRUCTURA', 'TAPITERIE', 'SPUMA', 'ACCESORII', 'AMBALAJ']),
})

const schemaFisa = z.object({
  cod: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]+$/, 'codul acceptă doar litere mari, cifre și cratimă'),
  denumire: z.string().trim().min(2),
  familie: z.enum(['PAT', 'CANAPEA', 'COLTAR', 'SALTEA', 'ALTELE']),
  pagini: z.array(z.string().trim().min(1)).min(1),
  note: z.string().trim().optional(),
  linii: z.array(schemaLinie).min(1),
})

/** Placeholder dimensions per family, in millimetres. The sheets state none. */
const DIMENSIUNI: Record<string, { lungime: string; latime: string; inaltime: string }> = {
  PAT: { lungime: '2000', latime: '1600', inaltime: '350' },
  CANAPEA: { lungime: '2000', latime: '900', inaltime: '850' },
  COLTAR: { lungime: '2600', latime: '1800', inaltime: '850' },
  SALTEA: { lungime: '2000', latime: '1600', inaltime: '200' },
  ALTELE: { lungime: '600', latime: '600', inaltime: '450' },
}

const DOSAR = resolve(import.meta.dirname, 'fise')

export function fiseDinJson(): Fisa[] {
  if (!existsSync(DOSAR)) return []

  const fise: Fisa[] = []

  for (const nume of readdirSync(DOSAR).filter((n) => n.endsWith('.json')).sort()) {
    const brut: unknown = JSON.parse(readFileSync(resolve(DOSAR, nume), 'utf8'))
    const rezultat = z.array(schemaFisa).safeParse(brut)

    if (!rezultat.success) {
      const primele = rezultat.error.issues
        .slice(0, 5)
        .map((i) => `    ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      throw new Error(`${nume} nu este valid:\n${primele}`)
    }

    for (const f of rezultat.data) {
      const dim = DIMENSIUNI[f.familie] ?? DIMENSIUNI['ALTELE']
      if (dim === undefined) continue

      fise.push({
        cod: f.cod,
        denumire: f.denumire,
        familie: f.familie,
        sursa: `fișa scanată ${f.denumire}${f.note === undefined ? '' : ` — ${f.note}`}`,
        pagini: f.pagini,
        dimensiune: { cod: 'STANDARD', ...dim },
        linii: f.linii.map((l) => ({
          nr: l.nr,
          denumire: l.denumire,
          um: l.um,
          cantitate: l.cantitate,
          grup: l.grup,
          // The upholstery fabric changes per order; its code is chosen on the bon.
          ...(/^(STOFA|MATERIAL TEXTIL)\b/.test(l.denumire.toUpperCase()) ? { variabil: true } : {}),
        })),
      })
    }
  }

  return fise
}

/**
 * Every recipe, hand-checked ones first.
 *
 * A JSON batch that repeats a code loses to the hand-checked version: those five
 * were read twice by different eyes and their numbers were verified against a
 * bon that went into SAGA.
 */
export function toateFisele(): Fisa[] {
  const verificate = new Set(FISE.map((f) => f.cod))
  return [...FISE, ...fiseDinJson().filter((f) => !verificate.has(f.cod))]
}
