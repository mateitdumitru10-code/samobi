import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { sagaArticle } from '@samobi/shared/db'
import { inArray, sql } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

/**
 * Fills each article's price from the last bon it was consumed on.
 *
 * The catalogue's average price is missing for five sixths of the articles, but
 * the production export carries a unit price on every consumption line — the
 * figure SAGA itself used when it booked the material. The most recent one is
 * kept, with its date, so a costing can say how old its price is instead of
 * presenting a two-year-old figure as current.
 *
 *   pnpm --filter @samobi/api preturi-din-productie
 *   pnpm --filter @samobi/api preturi-din-productie -- --scrie
 */

const scrie = process.argv.includes('--scrie')
const DOSAR = resolve(import.meta.dirname, '..', '..', '..', 'docs')

function zi(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10)
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
const iCod = antet.indexOf('cod1')
const iPret = antet.indexOf('pretunitar')
const iZi = antet.indexOf('data')

const ultimul = new Map<string, { pret: number; zi: number }>()

for (const rand of foaie.randuri.slice(1)) {
  const cod = rand[iCod] ?? ''
  const pret = Number(rand[iPret])
  const cand = Number(rand[iZi])
  if (cod === '' || !(pret > 0) || !(cand > 0)) continue

  const existent = ultimul.get(cod)
  if (existent === undefined || cand > existent.zi) ultimul.set(cod, { pret, zi: cand })
}

console.log(`${fisier}: ${ultimul.size} articole cu preț de consum.`)

const coduri = [...ultimul.keys()]
const cunoscute = new Set(
  (
    await db
      .select({ codSaga: sagaArticle.codSaga })
      .from(sagaArticle)
      .where(inArray(sagaArticle.codSaga, coduri))
  ).map((a) => a.codSaga),
)

const deScris = coduri.filter((c) => cunoscute.has(c))
console.log(`${deScris.length} există în nomenclator.`)

if (!scrie) {
  const exemple = deScris.slice(0, 8)
  for (const cod of exemple) {
    const v = ultimul.get(cod)
    if (v !== undefined) console.log(`  ${cod}  ${v.pret.toFixed(4)}  din ${zi(v.zi)}`)
  }
  console.log('\nNimic scris. Rulează cu --scrie.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

// One statement per batch rather than one per article: 1.500 round trips to
// Ireland is a minute of waiting for work the database does in a second.
const LOT = 500
let scrise = 0

for (let i = 0; i < deScris.length; i += LOT) {
  const lot = deScris.slice(i, i + LOT)
  const valori = lot.map((cod) => {
    const v = ultimul.get(cod)
    return { cod, pret: v?.pret ?? 0, data: zi(v?.zi ?? 0) }
  })

  await db.execute(sql`
    update saga_article a
    set pret_consum = v.pret::numeric, pret_consum_la = v.data::date
    from (values ${sql.join(
      valori.map((v) => sql`(${v.cod}, ${v.pret.toFixed(6)}, ${v.data})`),
      sql`, `,
    )}) as v(cod, pret, data)
    where a.cod_saga = v.cod`)

  scrise += lot.length
}

const [acoperire] = await db.execute<{ total: number; cu_pret: number }>(sql`
  select count(*)::int as total,
         count(coalesce(a.pret_referinta, a.pret_consum))::int as cu_pret
  from recipe_line rl join saga_article a on a.cod_saga = rl.cod_saga`)

console.log(`\n${scrise} prețuri scrise.`)
console.log(`Linii de rețetă cu preț: ${acoperire?.cu_pret ?? 0} din ${acoperire?.total ?? 0}.`)

await clientSql.end({ timeout: 10 })
