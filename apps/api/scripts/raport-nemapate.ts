import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sagaArticle } from '@samobi/shared/db'
import { sugereaza, type Candidat } from '@samobi/shared/nomenclator'
import { eq } from 'drizzle-orm'
import ExcelJS from 'exceljs'

import { clientSql, db } from '../src/db.js'

import { FISE } from './fise.js'

/**
 * Writes the worksheet a tehnolog fills in to finish the recipes.
 *
 * Every line of every transcribed sheet that the matcher would not accept on its
 * own, with the unit from the sheet and the three closest catalogue articles. One
 * column is left empty: the code the human chooses. Nothing here decides
 * anything — deciding is the point of the sheet.
 *
 *   pnpm --filter @samobi/api raport-nemapate
 */

const toate = await db
  .select({
    codSaga: sagaArticle.codSaga,
    denumire: sagaArticle.denumire,
    um: sagaArticle.um,
    tip: sagaArticle.tip,
  })
  .from(sagaArticle)
  .where(eq(sagaArticle.activ, true))

const materiiPrime: Candidat[] = toate
  .filter((a) => a.tip === 'materie_prima')
  .map((a) => ({ codSaga: a.codSaga, denumire: a.denumire }))

const umDupaCod = new Map(toate.map((a) => [a.codSaga, a.um]))

const liniiInReteta = await clientSql<{ recipe_cod: string; pozitie: string }[]>`
  select m.cod as recipe_cod,
         substring(rl.observatii from 'poziția ([0-9]+)') as pozitie
  from recipe_line rl
  join recipe r on r.id = rl.recipe_id
  join model m on m.id = r.model_id
  where rl.observatii is not null`

const acoperite = new Set(liniiInReteta.map((r) => `${r.recipe_cod}#${r.pozitie}`))

const registru = new ExcelJS.Workbook()
registru.creator = 'Samobi'
const foaie = registru.addWorksheet('De mapat')

foaie.addRow([
  'Model',
  'Poziția în fișă',
  'Material (din fișă)',
  'UM (din fișă)',
  'Cantitate',
  'COD ALES  ← completează aici',
  'Candidat 1',
  'Scor 1',
  'Candidat 2',
  'Scor 2',
  'Candidat 3',
  'Scor 3',
])
foaie.getRow(1).font = { bold: true }

let total = 0

for (const fisa of FISE) {
  for (const linie of fisa.linii) {
    if (linie.variabil === true) continue
    if (acoperite.has(`${fisa.cod}#${linie.nr}`)) continue

    total += 1
    const sugestii = sugereaza(linie.denumire, materiiPrime, { limita: 3, prag: 0.25 })
    const celule: (string | number)[] = [
      fisa.cod,
      linie.nr,
      linie.denumire,
      linie.um,
      Number(linie.cantitate),
      '',
    ]
    for (let i = 0; i < 3; i += 1) {
      const s = sugestii[i]
      celule.push(
        s === undefined ? '' : `${s.codSaga}  ${s.denumire} (${umDupaCod.get(s.codSaga) ?? '?'})`,
      )
      celule.push(s === undefined ? '' : Math.round(s.scor * 100))
    }
    foaie.addRow(celule)
  }
}

foaie.getColumn(2).numFmt = '0'
foaie.getColumn(5).numFmt = '0.0000'
foaie.getColumn(6).numFmt = '@'
foaie.getColumn(1).width = 20
foaie.getColumn(2).width = 14
foaie.getColumn(3).width = 30
foaie.getColumn(4).width = 10
foaie.getColumn(5).width = 12
foaie.getColumn(6).width = 26
for (const c of [7, 9, 11]) foaie.getColumn(c).width = 46
for (const c of [8, 10, 12]) foaie.getColumn(c).width = 8

const cale = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'materiale-de-mapat.xlsx')
writeFileSync(cale, Buffer.from(await registru.xlsx.writeBuffer()))

console.log(`${total} linii de mapat, din ${FISE.length} rețete.`)
for (const fisa of FISE) {
  const lipsa = fisa.linii.filter(
    (l) => l.variabil !== true && !acoperite.has(`${fisa.cod}#${l.nr}`),
  )
  console.log(
    `  ${fisa.cod.padEnd(20)} ${String(fisa.linii.length).padStart(3)} în fișă, ` +
      `${String(fisa.linii.length - lipsa.length).padStart(3)} în rețetă, ${lipsa.length} de mapat`,
  )
}
console.log('\nScris în docs/materiale-de-mapat.xlsx')
console.log('Completează coloana „COD ALES" și rulează: pnpm --filter @samobi/api aplica-mapari')

await clientSql.end({ timeout: 10 })
