import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { evalueazaFormula } from '@samobi/shared/calcul'
import ExcelJS from 'exceljs'

import { clientSql } from '../src/db.js'

/**
 * Turns a constant into a formula, by calibration rather than by invention.
 *
 * The sheets give one number per line at one size the tehnolog had in mind. A
 * formula needs a shape and a coefficient: the shape comes from what the
 * material physically is — a panel is an area, a zip is a length, fabric is
 * whole roll widths — and the coefficient is whatever makes the shape reproduce
 * the number that is already known to be right.
 *
 * That is the honest half. The dishonest half would be picking the shape for
 * somebody: one point fits every curve through it, so the script proposes the
 * candidates and the tehnolog says which is the material's real behaviour.
 *
 *   pnpm --filter @samobi/api propune-formule -- C3-SORIA 1900 1000 850
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

// pnpm passes its own `--` separator through to argv.
const argumente = process.argv.slice(2).filter((a) => a !== '--')
const [codModel, lungime, latime, inaltime] = argumente

if (codModel === undefined || lungime === undefined || latime === undefined) {
  console.error('Folosire: propune-formule -- <COD-MODEL> <L> <l> [H]   (milimetri)')
  console.error('  L, l, H = dimensiunile reale la care e scrisă fișa.')
  process.exit(1)
}

const scop = {
  L: Number(lungime),
  l: Number(latime),
  H: inaltime === undefined ? null : Number(inaltime),
}

/** Roll and panel sizes the workshop actually buys. */
const LATIME_BALOT = 1400
const PLACA_L = 2800
const PLACA_l = 2070

interface Sablon {
  nume: string
  /** `k` is substituted with the fitted coefficient. */
  expresie: string
  potrivit: (um: string) => boolean
}

const SABLOANE: Sablon[] = [
  {
    nume: 'suprafață',
    expresie: 'L*l/1000000 * k',
    potrivit: (um) => um === 'MP',
  },
  {
    nume: 'suprafață desfășurată (2 fețe + laterale)',
    expresie: '(L*l + 2*L*H + 2*l*H)/1000000 * k',
    potrivit: (um) => um === 'MP',
  },
  {
    nume: 'plăci întregi',
    expresie: `ceil(L/${PLACA_L}) * ceil(l/${PLACA_l}) * ${((PLACA_L * PLACA_l) / 1e6).toFixed(3)} * k`,
    potrivit: (um) => um === 'MP',
  },
  {
    nume: 'lungime',
    expresie: 'L/1000 * k',
    potrivit: (um) => um === 'ML' || um === 'M',
  },
  {
    nume: 'perimetru',
    expresie: '2*(L+l)/1000 * k',
    potrivit: (um) => um === 'ML' || um === 'M',
  },
  {
    nume: 'lățimi de balot × lungime',
    expresie: `ceil(l/${LATIME_BALOT}) * L/1000 * k`,
    potrivit: (um) => um === 'ML' || um === 'M',
  },
  {
    nume: 'volum',
    expresie: 'L*l*H/1000000000 * k',
    potrivit: (um) => um === 'MC',
  },
]

interface Rand {
  nr_linie: number
  grup: string
  um: string
  cantitate_fixa: string
  cod_saga: string | null
  denumire: string | null
}

const linii = await clientSql<Rand[]>`
  select rl.nr_linie, rl.grup, rl.um, rl.cantitate_fixa, rl.cod_saga, a.denumire
  from recipe_line rl
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  left join saga_article a on a.cod_saga = rl.cod_saga
  where m.cod = ${codModel} and rl.mod_calcul = 'fixa' and rl.cantitate_fixa is not null
  order by rl.nr_linie`

if (linii.length === 0) {
  console.error(`Modelul ${codModel} nu are linii pe mod „fixa".`)
  process.exit(1)
}

/** The coefficient that makes a shape reproduce the value already known good. */
function calibreaza(expresie: string, tinta: number): { k: number; formula: string } | null {
  const unitar = evalueazaFormula(expresie.replace(' * k', ''), scop)
  if (!unitar.esteNumar) return null
  const baza = Number(unitar.valoare.toString())
  if (!Number.isFinite(baza) || baza === 0) return null

  const k = tinta / baza
  // Four digits is finer than the sheets themselves are written.
  const kRotunjit = Number(k.toPrecision(4))
  return {
    k: kRotunjit,
    // Only a coefficient of exactly 1 is dropped, and only as a whole term:
    // stripping the substring ` * 1` turned `L/1000 * 1.105` into `L/1000.105`.
    formula: kRotunjit === 1 ? expresie.replace(' * k', '') : expresie.replace('k', String(kRotunjit)),
  }
}

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('Formule')

foaie.addRow([
  'Linia',
  'Grup',
  'Material',
  'UM',
  `Cantitate în fișă (la ${scop.L}×${scop.l}${scop.H === null ? '' : `×${scop.H}`})`,
  'FORMULA ALEASĂ  ← scrie aici',
  'Candidat 1',
  'Candidat 2',
  'Candidat 3',
])
foaie.getRow(1).font = { bold: true }

let cuCandidati = 0
const constante: string[] = []

console.log(`${codModel}, fișa scrisă la ${scop.L}×${scop.l}${scop.H === null ? '' : `×${scop.H}`} mm\n`)

for (const linie of linii) {
  const um = linie.um.trim().toUpperCase()
  const tinta = Number(linie.cantitate_fixa)
  const candidati = SABLOANE.filter((s) => s.potrivit(um))
    .map((s) => ({ sablon: s, fit: calibreaza(s.expresie, tinta) }))
    .filter((c): c is { sablon: Sablon; fit: { k: number; formula: string } } => c.fit !== null)

  if (candidati.length === 0) {
    constante.push(`${linie.nr_linie} · ${linie.denumire ?? linie.cod_saga ?? '?'} (${um})`)
    continue
  }
  cuCandidati += 1

  const eticheta = (c: (typeof candidati)[number] | undefined): string =>
    c === undefined ? '' : `${c.sablon.nume}:  ${c.fit.formula}`

  foaie.addRow([
    linie.nr_linie,
    linie.grup,
    linie.denumire ?? linie.cod_saga ?? '',
    um,
    tinta,
    '',
    eticheta(candidati[0]),
    eticheta(candidati[1]),
    eticheta(candidati[2]),
  ])

  console.log(`linia ${String(linie.nr_linie).padStart(3)}  ${(linie.denumire ?? '').slice(0, 30).padEnd(31)} ${String(tinta).padStart(8)} ${um}`)
  for (const c of candidati) {
    console.log(`            ${c.sablon.nume.padEnd(38)} ${c.fit.formula}`)
  }
  console.log()
}

foaie.getColumn(1).numFmt = '0'
foaie.getColumn(5).numFmt = '0.000'
foaie.getColumn(3).width = 34
foaie.getColumn(6).width = 34
for (const col of [7, 8, 9]) foaie.getColumn(col).width = 56

writeFileSync(resolve(DOSAR, 'formule-propuse.xlsx'), Buffer.from(await registru.xlsx.writeBuffer()))

console.log(`${cuCandidati} linii au candidați (UM de suprafață, lungime sau volum).`)
console.log(`${constante.length} rămân constante — corect, nu se schimbă cu dimensiunea:`)
for (const c of constante) console.log(`  ${c}`)

console.log('\nFiecare candidat reproduce exact cantitatea din fișă la dimensiunea de mai sus.')
console.log('Un singur punct se potrivește cu orice formulă — alege forma care descrie')
console.log('materialul, nu prima care iese. Scris în docs/formule-propuse.xlsx.')
console.log('\nApoi: pnpm --filter @samobi/api aplica-formule')

await clientSql.end({ timeout: 10 })
