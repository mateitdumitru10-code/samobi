import { inflateSync } from 'node:zlib'

/**
 * Text out of a PDF, with the positions kept.
 *
 * Written here rather than pulled in, for the same reason the XLSX reader was:
 * the files that matter come out of SAGA, and a general-purpose library brings
 * a great deal of PDF this never needs. What it does need is the geometry — a
 * report is a table, and a table read as a stream of words is a list of numbers
 * with nothing attached to them.
 *
 * SAGA writes these with `Flate`-compressed content streams, WinAnsi text and
 * no embedded font mapping, so the bytes are the characters.
 */

export interface Bucata {
  pagina: number
  /** distance down the page; larger is further down after the sign flip */
  y: number
  x: number
  text: string
}

/** Every `Flate` stream that carries drawing operators. */
function continuturi(date: Buffer): Buffer[] {
  const iesire: Buffer[] = []
  const tipar = /stream(\r\n|\r|\n)/g
  let potrivire: RegExpExecArray | null

  while ((potrivire = tipar.exec(date.toString('latin1'))) !== null) {
    const inceput = potrivire.index + potrivire[0].length
    const sfarsit = date.indexOf('endstream', inceput, 'latin1')
    if (sfarsit < 0) continue
    try {
      const desfacut = inflateSync(date.subarray(inceput, sfarsit))
      if (desfacut.includes('BT')) iesire.push(desfacut)
    } catch {
      // Not a Flate stream, or not one this needs: images, fonts, metadata.
    }
  }
  return iesire
}

const OCTAL = /\\(\d{3})/g
const ESCAPE = /\\([()\\])/g

function dinLiteral(brut: string): string {
  return brut
    .replace(OCTAL, (_, cifre: string) => String.fromCharCode(Number.parseInt(cifre, 8)))
    .replace(ESCAPE, '$1')
}

/**
 * Walks one content stream.
 *
 * `Td` moves relative to the line matrix and `BT` resets it — accumulating
 * across blocks puts every row of the report at the same height, which reads
 * as one long column of words.
 */
function* bucatiDin(flux: Buffer, pagina: number): Generator<Bucata> {
  let x = 0
  let y = 0

  for (const linieBruta of flux.toString('latin1').split('\n')) {
    const linie = linieBruta.trim()

    if (linie === 'BT') {
      x = 0
      y = 0
      continue
    }

    const mutare = /^(-?[\d.]+) (-?[\d.]+) Td$/.exec(linie)
    if (mutare !== null) {
      x += Number(mutare[1])
      y += Number(mutare[2])
      continue
    }

    // `'` shows the string on the next line; `Tj` shows it where the cursor is.
    const text = /^\((.*)\)\s*(?:'|Tj)$/s.exec(linie)
    if (text === null) continue

    const continut = dinLiteral(text[1] ?? '')
    if (continut.trim() === '') continue

    yield { pagina, y: -y, x, text: continut }
  }
}

/** The report's lines, in reading order, columns joined by two spaces. */
export function randuriPdf(date: Buffer): string[] {
  const peRand = new Map<string, Bucata[]>()

  continuturi(date).forEach((flux, pagina) => {
    for (const bucata of bucatiDin(flux, pagina)) {
      // A tenth of a point: the same printed row can differ in the last digit.
      const cheie = `${bucata.pagina}|${bucata.y.toFixed(1)}`
      const grup = peRand.get(cheie)
      if (grup === undefined) peRand.set(cheie, [bucata])
      else grup.push(bucata)
    }
  })

  return [...peRand.entries()]
    .sort(([a], [b]) => {
      const [pa, ya] = a.split('|')
      const [pb, yb] = b.split('|')
      return Number(pa) - Number(pb) || Number(ya) - Number(yb)
    })
    .map(([, bucati]) =>
      bucati
        .sort((a, b) => a.x - b.x)
        .map((b) => b.text)
        .join('  '),
    )
}
