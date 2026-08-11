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
  um: string | null
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

/**
 * A line, in the two shapes the print produces.
 *
 * With a unit, two figures are enough — the last one is cut off often enough
 * that demanding it loses real lines. Without a unit all three are required,
 * because a fragment like `00015370  BUC  6.4000` would otherwise pass as a
 * line whose quantity is really a price.
 *
 * The name is optional only where a unit follows the code, and that is not
 * tidiness: in FOTOLIU KIM the product's
 * name printed on a row of its own at the foot of the page, so its line began
 * with the code. Requiring a name there matched nothing, the file yielded no
 * bon at all, and seventeen materials went missing without a word — the model
 * kept its hand-written sheet instead. Nothing downstream needs the name: a
 * product is found by its SAGA code.
 */
const CU_UM = new RegExp(
  String.raw`^(?:(.*?)\s+)?(\d{8})\s+([A-Z0-9][A-Z0-9 ]{0,7}?)\s+(${NUMAR})\s+(${NUMAR})(?:\s+(${NUMAR}))?\s*$`,
)
// Here the name stays mandatory. With neither a name nor a unit, three figures
// after a code is exactly the shape of a fragment of a row split across content
// streams — and the figure in first position would be a price read as a
// quantity, which becomes a wrong stock movement in accounting.
const FARA_UM = new RegExp(
  String.raw`^(.*?)\s+(\d{8})\s+(${NUMAR})\s+(${NUMAR})\s+(${NUMAR})\s*$`,
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

    const cuUm = CU_UM.exec(rand)
    const faraUm = cuUm === null ? FARA_UM.exec(rand) : null
    if (cuUm === null && faraUm === null) continue

    const brut = ((cuUm ?? faraUm)?.[1] ?? '').trim()
    const prefix = GESTIUNE.exec(brut)
    if (prefix !== null) gestiune = prefix[1] ?? gestiune

    const linie: LiniePdf = {
      denumire: brut.replace(GESTIUNE, ''),
      gestiune,
      codSaga: (cuUm ?? faraUm)?.[2] ?? '',
      // Null when the print dropped the unit cell; the catalogue's own unit
      // stands in, and the importer says which lines those were.
      um: cuUm === null ? null : (cuUm[3] ?? '').trim(),
      cantitate: curata((cuUm?.[4] ?? faraUm?.[3]) ?? ''),
      pret: curata((cuUm?.[5] ?? faraUm?.[4]) ?? ''),
    }

    if (!inConsumuri) {
      curent = { nrIntern, data: dataBon, produs: linie, consumuri: [] }
      bonuri.push(curent)
    } else if (curent !== null && !curent.consumuri.some((c) => c.codSaga === linie.codSaga)) {
      // One article, one line. A row split across streams can be picked up
      // twice, the second time from a fragment with a figure that is not the
      // quantity.
      curent.consumuri.push(linie)
    }
  }

  return bonuri
}
