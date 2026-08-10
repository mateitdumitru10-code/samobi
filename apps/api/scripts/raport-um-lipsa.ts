import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sagaArticle } from '@samobi/shared/db'
import { asc, or, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'

import { clientSql, db } from '../src/db.js'

/**
 * Lists the catalogue articles that have no unit of measure.
 *
 * SAGA refuses an import line whose article has no unit, and the refusal names
 * the article rather than the cause, so this is the list to work through before
 * the next bon. Where another article carries the same name and does have a
 * unit, it is shown alongside: these are almost always an obsolete code and its
 * replacement.
 *
 *   pnpm --filter @samobi/api raport-um-lipsa
 */

const fara = await db
  .select({
    codSaga: sagaArticle.codSaga,
    denumire: sagaArticle.denumire,
    tip: sagaArticle.tip,
    cont: sagaArticle.cont,
    gestiune: sagaArticle.gestiuneImplicita,
    pret: sagaArticle.pretReferinta,
  })
  .from(sagaArticle)
  .where(or(sql`${sagaArticle.um} is null`, sql`btrim(${sagaArticle.um}) = ''`))
  .orderBy(asc(sagaArticle.tip), asc(sagaArticle.denumire))

const cuUm = await db
  .select({
    codSaga: sagaArticle.codSaga,
    denumire: sagaArticle.denumire,
    um: sagaArticle.um,
    tip: sagaArticle.tip,
    gestiune: sagaArticle.gestiuneImplicita,
  })
  .from(sagaArticle)
  .where(sql`btrim(${sagaArticle.um}) <> ''`)

const dupaDenumire = new Map<string, typeof cuUm>()
for (const articol of cuUm) {
  const cheie = articol.denumire.trim().toUpperCase()
  const grup = dupaDenumire.get(cheie)
  if (grup === undefined) dupaDenumire.set(cheie, [articol])
  else grup.push(articol)
}

/** Articles used by a recipe line right now — those block a bon today. */
const folositeAcum = await db.execute<{ cod_saga: string }>(sql`
  select distinct a.cod_saga
  from recipe_line rl
  join saga_article a on a.cod_saga = rl.cod_saga
  where a.um is null or btrim(a.um) = ''`)

const inFolosinta = new Set(folositeAcum.map((r) => r.cod_saga))

interface Rand {
  codSaga: string
  denumire: string
  tip: string
  gestiune: string | null
  inReteta: boolean
  inlocuitor: string
}

const randuri: Rand[] = fara.map((articol) => {
  const alternative = dupaDenumire.get(articol.denumire.trim().toUpperCase()) ?? []
  const materiiPrime = alternative.filter((a) => a.tip === 'materie_prima')
  const preferate = materiiPrime.length > 0 ? materiiPrime : alternative

  return {
    codSaga: articol.codSaga,
    denumire: articol.denumire,
    tip: articol.tip,
    gestiune: articol.gestiune,
    inReteta: inFolosinta.has(articol.codSaga),
    inlocuitor: preferate.map((a) => `${a.codSaga} (${a.um})`).join(' sau '),
  }
})

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('Fara UM')

foaie.addRow([
  'Cod SAGA',
  'Denumire',
  'Tip',
  'Gestiune',
  'Folosit în rețetă',
  'Alt cod cu aceeași denumire care are UM',
])
foaie.getRow(1).font = { bold: true }

for (const rand of randuri) {
  foaie.addRow([
    rand.codSaga,
    rand.denumire,
    rand.tip,
    rand.gestiune ?? '',
    rand.inReteta ? 'DA' : '',
    rand.inlocuitor,
  ])
}

foaie.getColumn(1).numFmt = '@'
foaie.getColumn(1).width = 12
foaie.getColumn(2).width = 44
foaie.getColumn(3).width = 14
foaie.getColumn(4).width = 24
foaie.getColumn(5).width = 16
foaie.getColumn(6).width = 34

const cale = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'materiale-fara-um.xlsx')
writeFileSync(cale, Buffer.from(await registru.xlsx.writeBuffer()))

const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(sagaArticle)

console.log(`${randuri.length} articole fără unitate de măsură, din ${total?.n ?? 0}.`)
console.log(`Scris în docs/materiale-fara-um.xlsx\n`)

const urgente = randuri.filter((r) => r.inReteta)
if (urgente.length > 0) {
  console.log('BLOCHEAZĂ UN BON ACUM:')
  for (const r of urgente) {
    console.log(`  ${r.codSaga}  ${r.denumire.padEnd(30)} → ${r.inlocuitor || 'niciun înlocuitor'}`)
  }
  console.log('')
}

const materii = randuri.filter((r) => r.tip === 'materie_prima')
console.log(`Materii prime fără UM (${materii.length}):`)
for (const r of materii) {
  console.log(`  ${r.codSaga}  ${r.denumire.padEnd(38)} ${r.gestiune ?? ''}`)
}

const cuInlocuitor = randuri.filter((r) => r.inlocuitor !== '')
console.log(
  `\n${cuInlocuitor.length} dintre ele au un alt cod cu aceeași denumire care are UM — ` +
    'probabil coduri vechi, de dezactivat în SAGA.',
)

await clientSql.end({ timeout: 10 })
