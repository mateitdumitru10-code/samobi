import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sagaArticle } from '@samobi/shared/db'
import { inArray } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'

/**
 * Turns the filled-in worksheet into a mapping file the loader obeys.
 *
 * The tehnolog writes a SAGA code next to a material; that decision is recorded
 * once, in scripts/mapari.json, and from then on it beats any similarity score.
 * Re-running the loader is then repeatable: same sheets plus same decisions give
 * the same recipes.
 *
 *   pnpm --filter @samobi/api aplica-mapari
 *   pnpm --filter @samobi/api incarca-fise -- --scrie --reincarca
 */

const caleXlsx = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'materiale-de-mapat.xlsx')
const caleJson = resolve(import.meta.dirname, 'mapari.json')

const foaie = citesteXlsx(readFileSync(caleXlsx))
const antet = foaie.randuri[0] ?? []

const coloana = (nume: string): number => {
  const index = antet.findIndex((c) => c.toLowerCase().startsWith(nume.toLowerCase()))
  if (index < 0) throw new Error(`Lipsește coloana „${nume}" din fișier.`)
  return index
}

const cModel = coloana('Model')
const cPozitie = coloana('Poziția')
const cMaterial = coloana('Material')
const cCod = coloana('COD ALES')

interface Alegere {
  model: string
  pozitie: number
  material: string
  cod: string
}

const alegeri: Alegere[] = []

for (let i = 1; i < foaie.randuri.length; i += 1) {
  const rand = foaie.randuri[i] ?? []
  const cod = (rand[cCod] ?? '').trim()
  if (cod === '') continue

  const pozitie = Number.parseInt(rand[cPozitie] ?? '', 10)
  if (Number.isNaN(pozitie)) continue

  alegeri.push({
    model: (rand[cModel] ?? '').trim(),
    pozitie,
    material: (rand[cMaterial] ?? '').trim(),
    // Tolerates a pasted "00001228  CUIE (KG)" as well as a bare code.
    cod: (cod.split(/\s+/)[0] ?? cod).trim(),
  })
}

if (alegeri.length === 0) {
  console.log('Nicio linie completată în coloana „COD ALES". Nu am ce aplica.')
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

const coduri = [...new Set(alegeri.map((a) => a.cod))]
const existente = new Set(
  (
    await db
      .select({ codSaga: sagaArticle.codSaga })
      .from(sagaArticle)
      .where(inArray(sagaArticle.codSaga, coduri))
  ).map((a) => a.codSaga),
)

const gresite = alegeri.filter((a) => !existente.has(a.cod))
if (gresite.length > 0) {
  console.error('Coduri care nu există în nomenclator — corectează-le în fișier:')
  for (const a of gresite) {
    console.error(`  ${a.model} poz. ${a.pozitie}  ${a.material}  →  ${a.cod}`)
  }
  await clientSql.end({ timeout: 5 })
  process.exit(1)
}

const anterioare: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(caleJson, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
})()

const mapari = { ...anterioare }
let noi = 0
let schimbate = 0

for (const a of alegeri) {
  const cheie = `${a.model}#${a.pozitie}`
  if (mapari[cheie] === undefined) noi += 1
  else if (mapari[cheie] !== a.cod) schimbate += 1
  mapari[cheie] = a.cod
}

writeFileSync(caleJson, `${JSON.stringify(mapari, null, 2)}\n`)

console.log(`${alegeri.length} alegeri citite: ${noi} noi, ${schimbate} modificate.`)
console.log(`Total în scripts/mapari.json: ${Object.keys(mapari).length}.`)
console.log('\nAcum rulează: pnpm --filter @samobi/api incarca-fise -- --scrie --reincarca')

await clientSql.end({ timeout: 10 })
