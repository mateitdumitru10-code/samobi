import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeazaUm, numereDin, scorSimilaritate } from '@samobi/shared/nomenclator'

import { clientSql } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

import { toateFisele } from './fise-json.js'

/**
 * Applies only the re-mappings that need no judgement, and lists the rest.
 *
 * A candidate is taken without asking when all four hold:
 *
 *   1. it is in the unit the sheet uses,
 *   2. it appears on bons the factory actually booked,
 *   3. its numbers are exactly the sheet's numbers, in order, and there is at
 *      least one — the rule potrivireSigura is built on, because in this
 *      catalogue the numbers carry the meaning and CAPSE 380/16 is not
 *      CAPSE 80/16 however alike they read,
 *   4. it is the only article in the catalogue that satisfies 1–3.
 *
 * The letters then only have to rule out a different material entirely, so the
 * score floor is 0.6 rather than potrivireSigura's 0.7. Uniqueness is doing the
 * work the higher threshold does elsewhere: MDF BRUT 4MM scores 0.696 against a
 * sheet saying MDF 4MM and is the single MDF of 4 mm sold by the square metre,
 * with 1.102 bons behind it. Nothing else it could be.
 *
 * Two candidates passing makes it a choice, not a deduction, and it is left
 * alone — PAL 16 MM R and PAL BRUT 16 MM are both really PAL of 16 mm.
 * FERMOAR ALB against FERMOAR BEJ never gets this far: no numbers, no trust.
 *
 *   pnpm --filter @samobi/api remapare-evidente            # doar arată
 *   pnpm --filter @samobi/api remapare-evidente -- --scrie
 */

const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')
const CALE_JSON = resolve(import.meta.dirname, 'mapari.json')
const scrie = process.argv.includes('--scrie')

/** Units that count the same thing at a different scale — not a mismatch. */
const FACTOR: Readonly<Record<string, number>> = { BUC: 1, SUTEB: 100, MIIB: 1000 }

const um = (v: string | null | undefined): string => (normalizeazaUm(v ?? '') ?? '').toUpperCase()

/** Score floor once the numbers already agree and the candidate is alone. */
const PRAG = 0.6

function numereleCoincid(fisa: string, candidat: string): boolean {
  const aleFisei = numereDin(fisa)
  const aleCandidatului = numereDin(candidat)
  if (aleFisei.length === 0) return false
  return (
    aleFisei.length === aleCandidatului.length && aleFisei.every((n, i) => n === aleCandidatului[i])
  )
}

const fisier = readdirSync(DOSAR)
  .filter((n) => n.endsWith('.xlsx'))
  .sort()
  .reverse()
  .find((n) => {
    try {
      return citesteXlsx(readFileSync(resolve(DOSAR, n))).nume === 'Productie'
    } catch {
      return false
    }
  })

if (fisier === undefined) {
  console.error('Niciun export de producție în docs/.')
  process.exit(1)
}

const foaie = citesteXlsx(readFileSync(resolve(DOSAR, fisier)))
const antet = foaie.randuri[0] ?? []
const c = (nume: string): number => antet.indexOf(nume)

const bonuriCuArticol = new Map<string, Set<string>>()
for (const r of foaie.randuri.slice(1)) {
  const material = r[c('cod1')] ?? ''
  if (material === '') continue
  const set = bonuriCuArticol.get(material) ?? new Set<string>()
  set.add(r[c('nr')] ?? '')
  bonuriCuArticol.set(material, set)
}

const catalog = await clientSql<{ cod_saga: string; denumire: string; um: string }[]>`
  select cod_saga, denumire, um
  from saga_article
  where activ and btrim(um) <> ''`

const linii = await clientSql<
  {
    cod_saga: string
    nr_linie: number
    um_reteta: string
    um_saga: string
    denumire: string
    model: string
  }[]
>`
  select rl.cod_saga, rl.nr_linie, rl.um as um_reteta, a.um as um_saga, a.denumire, m.cod as model
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where btrim(a.um) <> ''
    and upper(btrim(rl.um)) <> upper(btrim(a.um))
  order by m.cod, rl.nr_linie`

const fise = new Map(toateFisele().map((f) => [f.cod, new Map(f.linii.map((l) => [l.nr, l]))]))

interface Evidenta {
  model: string
  nrLinie: number
  material: string
  umFisa: string
  codAcum: string
  acum: string
  cod: string
  denumire: string
  scor: number
  bonuri: number
}

const candidate: Evidenta[] = []
const ambigue = new Map<string, number>()
const faraCandidat = new Map<string, number>()
/** Articles where at least one line needs a person: the whole article waits. */
const deDecis = new Set<string>()

for (const l of linii) {
  const aFisa = um(l.um_reteta)
  const aSaga = um(l.um_saga)
  if (FACTOR[aFisa] !== undefined && FACTOR[aSaga] !== undefined) continue

  const dinFisa = fise.get(l.model)?.get(l.nr_linie)
  if (dinFisa === undefined) continue

  const sigure = catalog
    .filter((x) => um(x.um) === aFisa && (bonuriCuArticol.get(x.cod_saga)?.size ?? 0) > 0)
    .map((x) => ({ ...x, scor: scorSimilaritate(dinFisa.denumire, x.denumire) }))
    .filter((x) => x.scor >= PRAG && numereleCoincid(dinFisa.denumire, x.denumire))

  const cheie = `${dinFisa.denumire} (${dinFisa.um})`

  const ales = sigure.length === 1 ? sigure[0] : undefined

  if (ales !== undefined) {
    candidate.push({
      model: l.model,
      nrLinie: l.nr_linie,
      material: dinFisa.denumire,
      umFisa: dinFisa.um,
      codAcum: l.cod_saga,
      acum: `${l.cod_saga} ${l.denumire} (${l.um_saga})`,
      cod: ales.cod_saga,
      denumire: ales.denumire,
      scor: ales.scor,
      bonuri: bonuriCuArticol.get(ales.cod_saga)?.size ?? 0,
    })
    continue
  }

  deDecis.add(l.cod_saga)
  if (sigure.length > 1) ambigue.set(cheie, (ambigue.get(cheie) ?? 0) + 1)
  else faraCandidat.set(cheie, (faraCandidat.get(cheie) ?? 0) + 1)
}

// The same catalogue article is often written several ways across the sheets —
// "PAL 16" on one, "PAL 16 MM" on the next. Re-pointing one spelling and
// leaving the other would split one decision in two, so if any line on an
// article needs a person, every line on it does.
const evidente = candidate.filter((e) => !deDecis.has(e.codAcum))
const amanate = candidate.length - evidente.length

const perMaterial = new Map<string, { n: number; e: Evidenta }>()
for (const e of evidente) {
  const cheie = `${e.material} (${e.umFisa})`
  const gasit = perMaterial.get(cheie)
  if (gasit === undefined) perMaterial.set(cheie, { n: 1, e })
  else gasit.n += 1
}

console.log(`Istoric: ${fisier}\n`)
console.log(`Evidente — se aplică (${evidente.length} linii, ${perMaterial.size} materiale):`)
for (const [cheie, { n, e }] of [...perMaterial].sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `  ${String(n).padStart(3)}× ${cheie.padEnd(24)} ${e.acum.slice(0, 34).padEnd(35)}→ ${e.cod}  ${e.denumire.slice(0, 30).padEnd(31)} nume ${Math.round(e.scor * 100)}%  ${e.bonuri} bonuri`,
  )
}

const rest = (m: Map<string, number>): string =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `  ${String(n).padStart(3)}× ${k}`)
    .join('\n')

if (amanate > 0) {
  console.log(
    `\n${amanate} linii aveau candidat unic, dar sunt pe un articol care oricum se decide manual — merg împreună.`,
  )
}

console.log(
  `\nAmbigue — mai mulți candidați la fel de buni, decizi tu (${[...ambigue.values()].reduce((a, b) => a + b, 0)} linii):`,
)
console.log(rest(ambigue))
console.log(
  `\nFără candidat sigur, decizi tu (${[...faraCandidat.values()].reduce((a, b) => a + b, 0)} linii):`,
)
console.log(rest(faraCandidat))

if (!scrie) {
  console.log('\nNimic scris. Rulează din nou cu --scrie ca să le aplice.')
  await clientSql.end({ timeout: 10 })
  process.exit(0)
}

const anterioare: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(CALE_JSON, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
})()

const mapari = { ...anterioare }
let noi = 0
let schimbate = 0

for (const e of evidente) {
  const cheie = `${e.model}#${e.nrLinie}`
  if (mapari[cheie] === undefined) noi += 1
  else if (mapari[cheie] !== e.cod) schimbate += 1
  mapari[cheie] = e.cod
}

writeFileSync(CALE_JSON, `${JSON.stringify(mapari, null, 2)}\n`)

console.log(`\nscripts/mapari.json: ${noi} noi, ${schimbate} modificate, ${Object.keys(mapari).length} în total.`)
console.log('Acum: pnpm --filter @samobi/api incarca-fise -- --scrie --reincarca')

await clientSql.end({ timeout: 10 })
