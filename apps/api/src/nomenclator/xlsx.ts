import { citesteArhiva, extrage } from './zip.js'

/**
 * Reads an XLSX into rows of plain strings.
 *
 * ExcelJS cannot open the files SAGA produces: they carry a namespace prefix on
 * every element — `<x:row>`, `<x:c>` — and ExcelJS matches unprefixed local
 * names, so it reports a worksheet with zero rows. That is a silent, total
 * failure on a file that Excel itself opens fine.
 *
 * This reader ignores prefixes, which makes it work on both SAGA's dialect and
 * the ordinary one. ExcelJS stays where it earns its keep: writing the export
 * that goes back into SAGA, where the cell formats have to be exact.
 *
 * Values come back as text, deliberately. A SAGA code is text with leading
 * zeros, and a quantity is a decimal that must not pass through a float.
 */

export interface FoaieCitita {
  nume: string
  /** Row-major, column-indexed from 0. Gaps are empty strings. */
  randuri: string[][]
}

const ENTITATI: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function deEscapeaza(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (potrivire, cod: string) => {
    if (cod.startsWith('#x') || cod.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(cod.slice(2), 16))
    }
    if (cod.startsWith('#')) return String.fromCodePoint(Number.parseInt(cod.slice(1), 10))
    return ENTITATI[cod] ?? potrivire
  })
}

/** 'BC12' -> 54. Column letters are base-26 with no zero. */
function indexColoana(referinta: string): number {
  let index = 0
  for (const caracter of referinta) {
    const cod = caracter.charCodeAt(0)
    if (cod < 65 || cod > 90) break
    index = index * 26 + (cod - 64)
  }
  return index - 1
}

function citesteSiruriPartajate(xml: string | null): string[] {
  if (xml === null) return []
  const siruri: string[] = []
  // <si> may hold a single <t>, or several inside <r> runs that must be joined.
  const siRe = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g
  const tRe = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g

  let potrivireSi: RegExpExecArray | null
  while ((potrivireSi = siRe.exec(xml)) !== null) {
    const continut = potrivireSi[1] ?? ''
    let text = ''
    let potrivireT: RegExpExecArray | null
    tRe.lastIndex = 0
    while ((potrivireT = tRe.exec(continut)) !== null) {
      text += potrivireT[1] ?? ''
    }
    siruri.push(deEscapeaza(text))
  }
  return siruri
}

function atribut(atribute: string, nume: string): string | null {
  const potrivire = new RegExp(`\\b${nume}="([^"]*)"`).exec(atribute)
  return potrivire?.[1] ?? null
}

function citesteFoaie(xml: string, siruri: readonly string[]): string[][] {
  const randuri: string[][] = []

  const randRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g
  const celulaRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g
  const valoareRe = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/
  const inlineRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/

  let potrivireRand: RegExpExecArray | null
  while ((potrivireRand = randRe.exec(xml)) !== null) {
    const continut = potrivireRand[2]
    if (continut === undefined) continue

    const celule: string[] = []
    let potrivireCelula: RegExpExecArray | null
    celulaRe.lastIndex = 0

    while ((potrivireCelula = celulaRe.exec(continut)) !== null) {
      const atribute = potrivireCelula[1] ?? ''
      const corp = potrivireCelula[2] ?? ''
      const referinta = atribut(atribute, 'r')
      const tip = atribut(atribute, 't')

      let valoare = ''
      if (tip === 'inlineStr') {
        valoare = deEscapeaza(inlineRe.exec(corp)?.[1] ?? '')
      } else {
        const brut = valoareRe.exec(corp)?.[1] ?? ''
        if (tip === 's') {
          const index = Number.parseInt(brut, 10)
          valoare = Number.isNaN(index) ? '' : (siruri[index] ?? '')
        } else {
          valoare = deEscapeaza(brut)
        }
      }

      const index = referinta === null ? celule.length : indexColoana(referinta)
      while (celule.length < index) celule.push('')
      celule[index] = valoare
    }

    randuri.push(celule)
  }

  return randuri
}

export function citesteXlsx(buffer: Buffer): FoaieCitita {
  const intrari = citesteArhiva(buffer)

  const ia = (nume: string): string | null => {
    const intrare = intrari.get(nume) ?? intrari.get(`/${nume}`)
    return intrare === undefined ? null : extrage(buffer, intrare).toString('utf8')
  }

  const registru = ia('xl/workbook.xml')
  if (registru === null) throw new Error('Fișierul nu este un XLSX: lipsește xl/workbook.xml.')

  const numeFoaie = deEscapeaza(
    /<(?:\w+:)?sheet\b[^>]*\bname="([^"]*)"/.exec(registru)?.[1] ?? 'Foaie1',
  )

  const siruri = citesteSiruriPartajate(ia('xl/sharedStrings.xml'))

  // The first worksheet, whatever it is called. Sheet order in the archive is
  // not guaranteed to match the workbook, so sort by name.
  const numeFoi = [...intrari.keys()]
    .filter((n) => /(^|\/)xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()

  const primaFoaie = numeFoi[0]
  if (primaFoaie === undefined) throw new Error('Fișierul nu conține nicio foaie de calcul.')

  const xmlFoaie = ia(primaFoaie)
  if (xmlFoaie === null) throw new Error('Foaia de calcul nu a putut fi citită.')

  return { nume: numeFoaie, randuri: citesteFoaie(xmlFoaie, siruri) }
}
