import { createInterface } from 'node:readline/promises'

import { sagaCredential } from '@samobi/shared/db'
import { eq } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'
import { inregistreazaCheia, seamanaDinMediu } from '../src/saga/cheie.js'

/**
 * Registers the SAGA WEB access key, and reports on the one in use.
 *
 * This is the recovery path, and it is manual on purpose: nothing in the
 * application can mint a SAGA key. When SAGA blocks the current one — which it
 * does the moment a rotation goes unstored — an admin generates a fresh key in
 * SAGA WEB, under Administrare → Utilizatori → Utilizatori Integrare API, and
 * hands it over here.
 *
 *   pnpm --filter @samobi/api cheie-saga           # what is the state of the key
 *   pnpm --filter @samobi/api cheie-saga --scrie   # paste a new one
 *
 * The key is typed in, never passed as an argument: arguments end up in shell
 * history and in the process list, where anyone on the machine can read them.
 */

const scrie = process.argv.includes('--scrie')

const [starea] = await db.select().from(sagaCredential).where(eq(sagaCredential.id, 1)).limit(1)

if (starea === undefined) {
  console.log('Nu există nicio cheie înregistrată.')
} else {
  console.log(`Cheie înregistrată, rotită de ${starea.rotiri} ori, ultima dată ${starea.rotitaLa.toISOString()}.`)
  if (starea.invalida) {
    console.log(`BLOCATĂ: ${starea.motivInvalida ?? 'motiv necunoscut'}`)
    console.log('Generează una nouă în SAGA WEB și rulează din nou cu --scrie.')
  }
  if (starea.rezervataPana !== null && starea.rezervataPana > new Date()) {
    console.log(
      `Rezervată până la ${starea.rezervataPana.toISOString()} de „${starea.rezervataDe ?? '?'}".`,
    )
  }
}

/**
 * First-time bootstrap only: copies `SAGA_API_TOKEN` in, and refuses if a key is
 * already registered. After the first rotation the environment variable holds a
 * dead value, and overwriting the live key with it would block the integration.
 */
if (process.argv.includes('--din-mediu')) {
  const rezultat = await seamanaDinMediu()
  console.log(
    {
      semanata: '\nCheia din SAGA_API_TOKEN a fost înregistrată și cifrată în baza de date.',
      exista: '\nExistă deja o cheie înregistrată. Nu am atins-o — folosește --scrie ca s-o înlocuiești.',
      'fara-seminte': '\nSAGA_API_TOKEN lipsește din .env. Nu am ce înregistra.',
    }[rezultat],
  )
  await clientSql.end()
  process.exit(0)
}

if (!scrie) {
  console.log('\nRulează cu --scrie ca să înregistrezi o cheie nouă, sau cu --din-mediu prima dată.')
  await clientSql.end()
  process.exit(0)
}

const consola = createInterface({ input: process.stdin, output: process.stdout })
const cheie = await consola.question('Lipește cheia de acces din SAGA WEB: ')
consola.close()

if (cheie.trim() === '') {
  console.error('Nu ai introdus nimic. Nu am schimbat nimic.')
  await clientSql.end()
  process.exit(1)
}

await inregistreazaCheia(cheie)
console.log(`Cheie înregistrată (${cheie.trim().length} caractere), cifrată în baza de date.`)
console.log('Dacă era blocată, e deblocată acum.')

await clientSql.end()
