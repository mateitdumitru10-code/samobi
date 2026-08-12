import { env } from '../env.js'
import { CerereInvalida, EroareApi } from '../erori.js'

import { CheieSagaInvalida, cuCheiaSaga, marcheazaInvalida } from './cheie.js'
import { citesteSituatie } from './xml.js'

/**
 * The read side of SAGA WEB.
 *
 * Everything goes through `cuCheiaSaga`, which holds the key, stores whatever
 * replacement SAGA hands back and lets exactly one request through at a time.
 * Nothing in this file touches the key directly, and nothing outside this file
 * calls SAGA.
 */

const BAZA = env.SAGA_API_URL
/** A month of stock is 22 MB. The ceiling is for a hung connection, not a slow one. */
const RABDARE_MS = 120_000

export class SagaIndisponibila extends EroareApi {
  constructor(detaliu: string) {
    super(
      503,
      'SAGA_INDISPONIBILA',
      `SAGA nu răspunde (${detaliu}). Stocul rămâne cel citit ultima dată.`,
    )
  }
}

/** SAGA accepts one date format and refuses every other. */
export function dataSaga(zi: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(zi.getDate())}.${p(zi.getMonth() + 1)}.${zi.getFullYear()}`
}

interface Raspuns {
  status: number
  text: string
  esteXml: boolean
}

/**
 * One request, with the key held for its duration.
 *
 * The refresh header is read off the response and handed back to `cuCheiaSaga`
 * before the body is even touched: a body that fails to download must not cost
 * the key.
 */
async function cere(cale: string, cine: string): Promise<Raspuns> {
  const codFiscal = env.SAGA_COD_FISCAL
  if (codFiscal === undefined || codFiscal.trim() === '') {
    throw new Error('SAGA_COD_FISCAL lipseste din apps/api/.env.')
  }

  return cuCheiaSaga(cine, async (token) => {
    let raspuns: Response
    try {
      raspuns = await fetch(`${BAZA}${cale}`, {
        headers: {
          authorization: `Bearer ${token}`,
          'x-saga-cod-fiscal': codFiscal.trim(),
          accept: 'application/xml, application/json',
        },
        signal: AbortSignal.timeout(RABDARE_MS),
      })
    } catch (err) {
      // No response, so whether SAGA rotated the key is unknowable. The lease is
      // released by `cuCheiaSaga`; if the key did rotate, the next call comes
      // back 401 and says so in as many words.
      throw new SagaIndisponibila(err instanceof Error ? err.message : 'eroare de rețea')
    }

    const tokenNou = raspuns.headers.get('x-saga-refresh-token')
    const tip = raspuns.headers.get('content-type') ?? ''
    // Decoding follows the HTTP header. The declaration inside the document
    // claims UTF-16 and is wrong — see the note in xml.ts.
    const text = await raspuns.text()

    return {
      rezultat: { status: raspuns.status, text, esteXml: tip.includes('xml') },
      tokenNou,
    }
  })
}

/** SAGA's own words, when it bothered to send any. */
function mesajulSagai(text: string): string {
  try {
    const corp = JSON.parse(text) as { message?: unknown; error?: unknown }
    const mesaj = corp.message ?? corp.error
    if (typeof mesaj === 'string' && mesaj.trim() !== '') return mesaj.trim()
  } catch {
    /* not JSON; fall through */
  }
  return text.slice(0, 200).trim()
}

async function verifica(raspuns: Raspuns, ce: string): Promise<void> {
  if (raspuns.status >= 200 && raspuns.status < 300) return

  const mesaj = mesajulSagai(raspuns.text)

  if (raspuns.status === 401 || raspuns.status === 403) {
    // The one failure that does not fix itself. Recording why turns a puzzling
    // 401 into a screen that names the missing step.
    await marcheazaInvalida(`SAGA a răspuns ${raspuns.status}: ${mesaj}`)
    throw new CheieSagaInvalida(mesaj)
  }
  if (raspuns.status === 400) throw new CerereInvalida(`SAGA a refuzat cererea (${ce}): ${mesaj}`)

  throw new SagaIndisponibila(`${ce}, cod ${raspuns.status}: ${mesaj}`)
}

/** One row per article and gestiune, as SAGA keeps them. */
export interface RandStoc {
  /** Warehouse code, `0001`. `denumireGestiune` is what people call it. */
  gestiune: string
  denumireGestiune: string
  codSaga: string
  denumire: string
  um: string
  /**
   * Closing quantity, as a string.
   *
   * Never a number: `numeric(18,6)` does not survive a float, and this value
   * ends up compared against recipe quantities that obey the same rule. SAGA
   * writes it with a dot and at most three decimals, and it can be negative —
   * stock below zero is a real state there, so „epuizat" means `<= 0`.
   */
  cantitateFinala: string
}

/**
 * Stock across every warehouse, for a period.
 *
 * Articles with neither a balance nor a movement in the window are simply
 * absent — three recipe materials are in exactly that state. Absence is not
 * zero, and a caller that treats it as zero will report a shortage that does
 * not exist.
 */
export async function situatieStocuri(deLa: Date, panaLa: Date): Promise<RandStoc[]> {
  const raspuns = await cere(
    `/Situatii/GetSituatieStocuri?dataStart=${dataSaga(deLa)}&dataEnd=${dataSaga(panaLa)}`,
    'situatie-stocuri',
  )
  await verifica(raspuns, 'situația stocurilor')

  return citesteSituatie(raspuns.text).map((r) => ({
    gestiune: r['GESTIUNE'] ?? '',
    denumireGestiune: r['DEN_GEST'] ?? '',
    codSaga: r['COD_ART'] ?? '',
    denumire: r['DENUMIRE'] ?? '',
    um: r['UM'] ?? '',
    cantitateFinala: r['CANT_FIN'] ?? '0',
  }))
}

/**
 * The stock of a single article, for confirming a shortage before acting on it.
 *
 * Costs a whole round trip and therefore a chance to lose the key, so it is not
 * for loops — the bulk reading above answers the same question for everything
 * at once.
 */
export async function stocArticol(
  codSaga: string,
  optiuni: { gestiune?: string; la?: Date } = {},
): Promise<string> {
  const parametri = new URLSearchParams({ codArticol: codSaga })
  if (optiuni.gestiune !== undefined) parametri.set('gestiune', optiuni.gestiune)
  if (optiuni.la !== undefined) parametri.set('data', dataSaga(optiuni.la))

  const raspuns = await cere(`/Situatii/GetStocArticol?${parametri.toString()}`, 'stoc-articol')
  await verifica(raspuns, `stocul articolului ${codSaga}`)

  const corp = JSON.parse(raspuns.text) as { success?: boolean; message?: string; data?: unknown }
  if (corp.success !== true) {
    throw new SagaIndisponibila(corp.message ?? 'răspuns fără succes la stocul articolului')
  }
  // A string, and it stays one.
  return typeof corp.data === 'string' ? corp.data.trim() : String(corp.data ?? '0')
}
