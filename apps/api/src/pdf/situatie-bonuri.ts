import { randuriPdf } from './text.js'

/**
 * SAGA's „Situație bonuri de predare cu consumuri", read back.
 *
 * One production bon per report: the finished product on one line, then the
 * materials that went into it. Every line carries the SAGA code, which is the
 * whole point — the transcribed sheets carry names a person wrote by hand, and
 * seventy-three of those still have no article behind them. Nothing here needs
 * matching to anything.
 *
 * What the report does not carry: the group a material belongs to, and any
 * separation between the material itself and the waste. The quantity is what
 * was actually consumed, waste included.
 */

export interface LiniePdf {
  denumire: string
  codSaga: string
  um: string
  cantitate: string
  pret: string | null
  /** the warehouse it was discharged from; at this factory always MATERII PRIME */
  gestiune: string | null
}

export interface BonPdf {
  nrIntern: string | null
  data: string | null
  produs: LiniePdf
  consumuri: LiniePdf[]
}

/** `1 810.0000` — thousands separated by a space, as SAGA prints them. */
const NUMAR = String.raw`[\d ]+\.\d+`
const LINIE = new RegExp(
  String.raw`^(.*?)\s\s+(\d{8})\s\s+(\S+)\s+(${NUMAR})\s+(${NUMAR})\s+(${NUMAR})$`,
)
const ANTET_BON = /^(\d+)\s+(\d\d\.\d\d\.\d{4})\b/
/**
 * The warehouse sits in the same printed cell as the name — except when the
 * name is long enough to wrap, and then it prints on a row of its own. Sixty-
 * eight of the fourteen hundred lines are like that, so both shapes are read.
 */
const GESTIUNI = [
  'MATERII PRIME',
  'PRODUSE FINITE',
  'MARFA',
  'AMBALAJE',
  'MATERIALE CONSUMABILE',
  'OBIECTE DE INVENTAR',
] as const
const GESTIUNE = new RegExp(`^(${GESTIUNI.join('|')})\\s+`)

function curata(numar: string): string {
  return numar.replace(/\s/g, '')
}

export function citesteSituatieBonuri(date: Buffer): BonPdf[] {
  const bonuri: BonPdf[] = []
  let curent: BonPdf | null = null
  let inConsumuri = false
  let nrIntern: string | null = null
  let dataBon: string | null = null
  let gestiune: string | null = null

  for (const rand of randuriPdf(date)) {
    const singura = GESTIUNI.find((g) => rand.trim() === g)
    if (singura !== undefined) {
      gestiune = singura
      continue
    }

    if (rand.startsWith('Consumuri')) {
      inConsumuri = true
      continue
    }

    const antet = ANTET_BON.exec(rand)
    if (antet !== null) {
      inConsumuri = false
      nrIntern = antet[1] ?? null
      dataBon = antet[2] ?? null
      continue
    }

    const potrivire = LINIE.exec(rand)
    if (potrivire === null) continue

    const brut = (potrivire[1] ?? '').trim()
    const prefix = GESTIUNE.exec(brut)
    if (prefix !== null) gestiune = prefix[1] ?? gestiune

    const linie: LiniePdf = {
      denumire: brut.replace(GESTIUNE, ''),
      gestiune,
      codSaga: potrivire[2] ?? '',
      um: potrivire[3] ?? '',
      cantitate: curata(potrivire[4] ?? ''),
      pret: curata(potrivire[5] ?? ''),
    }

    if (!inConsumuri) {
      curent = { nrIntern, data: dataBon, produs: linie, consumuri: [] }
      bonuri.push(curent)
    } else if (curent !== null) {
      curent.consumuri.push(linie)
    }
  }

  return bonuri
}
