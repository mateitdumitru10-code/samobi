import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

import { sagaCredential } from '@samobi/shared/db'
import { and, eq, sql } from 'drizzle-orm'

import { db } from '../db.js'
import { env } from '../env.js'
import { EroareApi } from '../erori.js'

/**
 * Custody of the one SAGA WEB access key.
 *
 * SAGA hands back a replacement key in `X-Saga-Refresh-Token` whenever it feels
 * like it, and a rotation that is not stored blocks the key for good — the
 * documentation says so and two keys have been burned proving it. Every rule
 * here follows from that single fact:
 *
 * - one caller at a time, because two requests sharing a key means one of them
 *   is holding a value the server has already replaced;
 * - the new key is written before the response body is even read, because an
 *   exception between receiving it and storing it costs a trip to SAGA's web
 *   interface;
 * - the key is stored encrypted, because everyone with the Supabase dashboard
 *   can read `public` and this row is a credential to the company's accounting.
 *
 * Nothing here recovers from a blocked key. Nothing can — only a human with an
 * admin account in SAGA WEB can mint another. What this module does is make the
 * blocked state loud and named instead of a puzzling 401 somewhere downstream.
 */

/** Long enough for a 21 MB stock download, short enough that a crash is forgiven quickly. */
const REZERVARE_MINUTE = 5

const ALGORITM = 'aes-256-gcm'
const OCTETI_IV = 12
const OCTETI_ETICHETA = 16

export class CheieSagaLipsa extends EroareApi {
  constructor() {
    super(
      503,
      'CHEIE_SAGA_LIPSA',
      'Nu există o cheie de acces pentru SAGA. Generează una din SAGA WEB, ' +
        'Administrare → Utilizatori → Utilizatori Integrare API, și înregistreaz-o în aplicație.',
    )
  }
}

export class CheieSagaInvalida extends EroareApi {
  constructor(motiv: string) {
    super(
      503,
      'CHEIE_SAGA_INVALIDA',
      `Cheia de acces pentru SAGA nu mai este valabilă (${motiv}). ` +
        'Generează una nouă din SAGA WEB și înregistreaz-o în aplicație.',
    )
  }
}

export class CheieSagaOcupata extends EroareApi {
  constructor(deCine: string | null) {
    super(
      409,
      'CHEIE_SAGA_OCUPATA',
      'Se citește deja din SAGA' +
        (deCine === null ? '' : ` (${deCine})`) +
        '. Cheia se folosește pe rând, ca să nu se blocheze. Încearcă peste câteva secunde.',
    )
  }
}

/**
 * The encryption key, as 32 raw bytes.
 *
 * Accepts hex or base64 because the two are easy to confuse and a key that is
 * silently the wrong length would only surface as garbage on decryption.
 */
function cheieDeCifrare(): Buffer {
  const brut = env.SAGA_TOKEN_KEY
  if (brut === undefined || brut.trim() === '') {
    throw new Error(
      'SAGA_TOKEN_KEY lipseste. Genereaza una cu `openssl rand -base64 32` si pune-o in apps/api/.env.',
    )
  }
  const curat = brut.trim()
  const octeti = /^[0-9a-fA-F]{64}$/.test(curat)
    ? Buffer.from(curat, 'hex')
    : Buffer.from(curat, 'base64')

  if (octeti.length !== 32) {
    throw new Error(
      `SAGA_TOKEN_KEY are ${octeti.length} octeti, sunt necesari 32. Genereaza cu \`openssl rand -base64 32\`.`,
    )
  }
  return octeti
}

/** `iv | tag | ciphertext`, base64. */
export function cifreaza(text: string, cheie: Buffer = cheieDeCifrare()): string {
  const iv = randomBytes(OCTETI_IV)
  const cifru = createCipheriv(ALGORITM, cheie, iv)
  const continut = Buffer.concat([cifru.update(text, 'utf8'), cifru.final()])
  return Buffer.concat([iv, cifru.getAuthTag(), continut]).toString('base64')
}

export function descifreaza(pachet: string, cheie: Buffer = cheieDeCifrare()): string {
  const brut = Buffer.from(pachet, 'base64')
  if (brut.length <= OCTETI_IV + OCTETI_ETICHETA) {
    throw new Error('Cheia SAGA stocata este trunchiata.')
  }
  const cifru = createDecipheriv(ALGORITM, cheie, brut.subarray(0, OCTETI_IV))
  // GCM authenticates as well as encrypts: a tampered row fails here rather
  // than handing back a plausible-looking wrong key.
  cifru.setAuthTag(brut.subarray(OCTETI_IV, OCTETI_IV + OCTETI_ETICHETA))
  return Buffer.concat([
    cifru.update(brut.subarray(OCTETI_IV + OCTETI_ETICHETA)),
    cifru.final(),
  ]).toString('utf8')
}

/**
 * Writes a key that a human has just generated in SAGA WEB.
 *
 * Also the only way out of the blocked state, which is why it clears both the
 * flag and any lease left behind by whatever died last.
 */
export async function inregistreazaCheia(tokenClar: string): Promise<void> {
  const curat = tokenClar.trim()
  if (curat === '') throw new Error('Cheia SAGA este goala.')

  await db
    .insert(sagaCredential)
    .values({ id: 1, cheie: cifreaza(curat), invalida: false, motivInvalida: null })
    .onConflictDoUpdate({
      target: sagaCredential.id,
      set: {
        cheie: cifreaza(curat),
        rotitaLa: new Date(),
        rezervataPana: null,
        rezervataDe: null,
        invalida: false,
        motivInvalida: null,
      },
    })
}

/**
 * Takes the key out of circulation and returns it.
 *
 * One statement, so two callers arriving together cannot both win: the loser
 * updates no rows and is told to come back. The lease expires on its own, so a
 * process that dies mid-call does not wedge the feature forever.
 */
async function rezerva(cine: string): Promise<string> {
  const [randul] = await db
    .update(sagaCredential)
    .set({
      rezervataPana: sql`now() + ${`${REZERVARE_MINUTE} minutes`}::interval`,
      rezervataDe: cine,
    })
    .where(
      and(
        eq(sagaCredential.id, 1),
        eq(sagaCredential.invalida, false),
        sql`(${sagaCredential.rezervataPana} is null or ${sagaCredential.rezervataPana} < now())`,
      ),
    )
    .returning({ cheie: sagaCredential.cheie })

  if (randul !== undefined) return descifreaza(randul.cheie)

  // Nothing was updated. Which of the three reasons it was decides what the
  // user is told, and only one of them is worth retrying.
  const [starea] = await db.select().from(sagaCredential).where(eq(sagaCredential.id, 1)).limit(1)
  if (starea === undefined) throw new CheieSagaLipsa()
  if (starea.invalida) throw new CheieSagaInvalida(starea.motivInvalida ?? 'motiv necunoscut')
  throw new CheieSagaOcupata(starea.rezervataDe)
}

/** Stores the replacement key and releases the lease, in one statement. */
async function roteste(tokenNou: string): Promise<void> {
  await db
    .update(sagaCredential)
    .set({
      cheie: cifreaza(tokenNou),
      rotitaLa: new Date(),
      rotiri: sql`${sagaCredential.rotiri} + 1`,
      rezervataPana: null,
      rezervataDe: null,
    })
    .where(eq(sagaCredential.id, 1))
}

async function elibereaza(): Promise<void> {
  await db
    .update(sagaCredential)
    .set({ rezervataPana: null, rezervataDe: null })
    .where(eq(sagaCredential.id, 1))
}

export async function marcheazaInvalida(motiv: string): Promise<void> {
  await db
    .update(sagaCredential)
    .set({ invalida: true, motivInvalida: motiv, rezervataPana: null, rezervataDe: null })
    .where(eq(sagaCredential.id, 1))
}

/**
 * The only sanctioned way to call SAGA.
 *
 * Callers hand over a function that performs the request and reports back the
 * `X-Saga-Refresh-Token` it saw; everything about holding, rotating and
 * releasing the key happens here. Forgetting to store a rotation is the one
 * mistake that cannot be undone, so it is not left to the caller to remember.
 *
 * The rotation is stored even when the request failed — a 400 rotated a key
 * once already, and an error response is no less binding than a successful one.
 */
export async function cuCheiaSaga<T>(
  cine: string,
  apel: (token: string) => Promise<{ rezultat: T; tokenNou: string | null }>,
): Promise<T> {
  const token = await rezerva(cine)

  let raspuns: { rezultat: T; tokenNou: string | null }
  try {
    raspuns = await apel(token)
  } catch (err) {
    // The request threw before reporting anything back, so whether SAGA rotated
    // the key is unknowable. Releasing the lease keeps the next attempt possible;
    // if the key was in fact rotated, that attempt fails and says so plainly.
    await elibereaza()
    throw err
  }

  if (raspuns.tokenNou !== null && raspuns.tokenNou.trim() !== '') {
    await roteste(raspuns.tokenNou.trim())
  } else {
    await elibereaza()
  }

  return raspuns.rezultat
}

/**
 * Seeds the table from `SAGA_API_TOKEN` if it has never been seeded.
 *
 * Only ever fills an empty table: the environment variable is a starting point,
 * and once SAGA has rotated the key, `.env` holds a dead value that must never
 * overwrite the live one.
 */
export async function seamanaDinMediu(): Promise<'semanata' | 'exista' | 'fara-seminte'> {
  const [existenta] = await db.select().from(sagaCredential).where(eq(sagaCredential.id, 1)).limit(1)
  if (existenta !== undefined) return 'exista'

  const samanta = env.SAGA_API_TOKEN
  if (samanta === undefined || samanta.trim() === '') return 'fara-seminte'

  await inregistreazaCheia(samanta)
  return 'semanata'
}

/** Exported for the tests; comparing keys anywhere else is a smell. */
export function cheiEgale(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
