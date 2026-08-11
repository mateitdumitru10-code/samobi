/**
 * What counts as a fabric — the thing a customer picks when the bon is issued.
 *
 * No fabric is fixed on any product, so the only judgement is what is *not*
 * one: zips, webbing, cord, wadding, edge banding, film. Those are named for
 * what they do, and the list is short enough to read and correct. Everything
 * else sold by the metre is a choice.
 *
 * Three earlier attempts inferred this from quantity, from how often an article
 * repeated, and from nineteen months of bons. Each was an argument about what a
 * name probably means, and each was wrong about something — OPTIMA reads like a
 * trim and is chosen, SHINY reads like a fabric and never varies. A list beats
 * a threshold here because it can be corrected by someone who knows.
 */

const CUVINTE_FUNCTIONALE = [
  'FERMOAR',
  'VATEX',
  'VATELINA',
  'LEZARDA',
  'CORDELINA',
  'LONJERON',
  'BANDA',
  'ELASTIC',
  'CHINGA',
  'SFOARA',
  'SNUR',
  'PANGLICA',
  'ATA',
  'PLASA',
  'PVC',
  'FOLIE',
  'ARC',
  'BURETE',
  'RIPS',
  'DUBLURA',
  'CANT',
  'CHEDER',
  'RELNET',
  // Sold by the metre and nowhere near a sofa cover: edge banding, tube,
  // cable, abrasive, nonwoven lining, steel profile.
  'ABS',
  'TEAVA',
  'CABLU',
  'ABRAZIV',
  'TNT',
  'PROFIL',
] as const

/** Fabric is bought and consumed by the metre. */
const UNITATI_TEXTILE = new Set(['ML', 'M'])

export function esteTextil(denumire: string, um: string): boolean {
  if (!UNITATI_TEXTILE.has(um.trim().toUpperCase())) return false
  const nume = denumire.trim().toUpperCase()
  return !CUVINTE_FUNCTIONALE.some((cuvant) => nume.startsWith(cuvant))
}
