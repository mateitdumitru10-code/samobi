import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { profile } from '@samobi/shared/db'
import { asc } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { importaNomenclator } from '../src/nomenclator/import.js'

/**
 * Imports a SAGA export from the command line.
 *
 * The same code path the API uses; this only spares you a browser for the first,
 * very large import.
 *
 *   pnpm --filter @samobi/api import-nomenclator -- docs/export.xlsx [--dezactiveaza-disparute]
 */

const cale = process.argv[2]
if (cale === undefined) {
  console.error('Folosire: import-nomenclator -- <cale/catre/export.xlsx>')
  process.exit(1)
}

const dezactiveaza = process.argv.includes('--dezactiveaza-disparute')

const [autor] = await db
  .select({ id: profile.id, nume: profile.nume })
  .from(profile)
  .orderBy(asc(profile.creatLa))
  .limit(1)

if (autor === undefined) {
  console.error('Nu există niciun utilizator. Rulează întâi bootstrap-admin.')
  process.exit(1)
}

const continut = readFileSync(resolve(cale))
const inceput = Date.now()

try {
  const raport = await importaNomenclator(continut, {
    fisier: basename(cale),
    utilizatorId: autor.id,
    dezactiveazaDisparute: dezactiveaza,
  })

  const secunde = ((Date.now() - inceput) / 1000).toFixed(1)
  console.log(`Import terminat în ${secunde}s, pe seama lui ${autor.nume}.`)
  console.log(`  rânduri în fișier   ${raport.randuriInFisier}`)
  console.log(`  articole distincte  ${raport.articoleInFisier}`)
  console.log(`  noi                 ${raport.noi}`)
  console.log(`  modificate          ${raport.modificate}`)
  console.log(`  neschimbate         ${raport.neschimbate}`)
  console.log(
    `  dispărute           ${raport.disparute}${dezactiveaza ? ' (dezactivate)' : ' (doar raportate)'}`,
  )

  if (raport.umNecunoscute.length > 0) {
    console.log('')
    console.log('UM pe care aplicația nu le recunoaște:')
    for (const { um, articole } of raport.umNecunoscute.slice(0, 15)) {
      console.log(`  ${um.padEnd(10)} ${articole} articole`)
    }
  }
} catch (err) {
  console.error('Import eșuat:', (err as Error).message)
  process.exitCode = 1
} finally {
  await clientSql.end({ timeout: 10 })
}
