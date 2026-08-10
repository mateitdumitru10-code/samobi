import { inflateRawSync } from 'node:zlib'

/**
 * A minimal ZIP reader, because an XLSX is a ZIP and Node has no unzip built in.
 *
 * Only what an XLSX needs: stored and deflated entries, read by name from the
 * central directory. No ZIP64, no encryption, no streaming — the files this
 * handles are a few megabytes.
 */

const SEMNATURA_EOCD = 0x06054b50
const SEMNATURA_INTRARE = 0x02014b50

interface Intrare {
  nume: string
  metoda: number
  dimensiuneComprimata: number
  dimensiuneNecomprimata: number
  offsetLocal: number
}

function gasesteEocd(buffer: Buffer): number {
  // The comment field can be up to 64 KB, so scan backwards over that window.
  const minim = Math.max(0, buffer.length - 0x10000 - 22)
  for (let i = buffer.length - 22; i >= minim; i -= 1) {
    if (buffer.readUInt32LE(i) === SEMNATURA_EOCD) return i
  }
  return -1
}

export function citesteArhiva(buffer: Buffer): Map<string, Intrare> {
  const eocd = gasesteEocd(buffer)
  if (eocd < 0) throw new Error('Fișierul nu este o arhivă ZIP validă (deci nici XLSX).')

  const numarIntrari = buffer.readUInt16LE(eocd + 10)
  let pozitie = buffer.readUInt32LE(eocd + 16)

  const intrari = new Map<string, Intrare>()

  for (let i = 0; i < numarIntrari; i += 1) {
    if (buffer.readUInt32LE(pozitie) !== SEMNATURA_INTRARE) {
      throw new Error('Directorul arhivei este corupt.')
    }
    const metoda = buffer.readUInt16LE(pozitie + 10)
    const dimensiuneComprimata = buffer.readUInt32LE(pozitie + 20)
    const dimensiuneNecomprimata = buffer.readUInt32LE(pozitie + 24)
    const lungimeNume = buffer.readUInt16LE(pozitie + 28)
    const lungimeExtra = buffer.readUInt16LE(pozitie + 30)
    const lungimeComentariu = buffer.readUInt16LE(pozitie + 32)
    const offsetLocal = buffer.readUInt32LE(pozitie + 42)
    const nume = buffer.toString('utf8', pozitie + 46, pozitie + 46 + lungimeNume)

    intrari.set(nume, {
      nume,
      metoda,
      dimensiuneComprimata,
      dimensiuneNecomprimata,
      offsetLocal,
    })

    pozitie += 46 + lungimeNume + lungimeExtra + lungimeComentariu
  }

  return intrari
}

export function extrage(buffer: Buffer, intrare: Intrare): Buffer {
  // Local headers may lie about sizes when a data descriptor follows, so the
  // central directory is the source of truth for everything but the offsets.
  const lungimeNume = buffer.readUInt16LE(intrare.offsetLocal + 26)
  const lungimeExtra = buffer.readUInt16LE(intrare.offsetLocal + 28)
  const inceput = intrare.offsetLocal + 30 + lungimeNume + lungimeExtra
  const date = buffer.subarray(inceput, inceput + intrare.dimensiuneComprimata)

  if (intrare.metoda === 0) return Buffer.from(date)
  if (intrare.metoda === 8) return inflateRawSync(date)
  throw new Error(`Metodă de compresie neacceptată: ${intrare.metoda}.`)
}

export function citesteFisier(buffer: Buffer, nume: string): string | null {
  const intrari = citesteArhiva(buffer)
  // Some producers write absolute paths in the archive ('/xl/workbook.xml').
  const intrare = intrari.get(nume) ?? intrari.get(`/${nume}`)
  if (intrare === undefined) return null
  return extrage(buffer, intrare).toString('utf8')
}
