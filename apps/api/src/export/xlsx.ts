import { createHash } from 'node:crypto'

import ExcelJS from 'exceljs'

/**
 * Writes the file that gets imported into SAGA's `Producție` screen.
 *
 * Four columns, one row per material, aggregated across the selected bons.
 */

export interface RandExport {
  codSaga: string
  denumire: string
  um: string
  /** already rounded to 3 decimals by the calculation engine */
  cantitate: string
}

/** Built-in Excel format 49: text. Applied to the code column. */
const FORMAT_TEXT = '@'
const FORMAT_CANTITATE = '0.000'

export const NUME_FOAIE = 'Consumuri'
export const ANTET = ['Cod', 'Denumire', 'UM', 'Cantitate'] as const

export async function scrieExport(randuri: readonly RandExport[]): Promise<Buffer> {
  const registru = new ExcelJS.Workbook()
  registru.creator = 'Samobi'
  const foaie = registru.addWorksheet(NUME_FOAIE)

  foaie.addRow([...ANTET])
  foaie.getRow(1).font = { bold: true }

  for (const rand of randuri) {
    // The code is written as a string, deliberately. '00023684' handed over as a
    // number becomes 23684, and SAGA then matches nothing at all.
    foaie.addRow([rand.codSaga, rand.denumire, rand.um, Number(rand.cantitate)])
  }

  // Critical: without the text format, Excel and anything reading the file
  // re-interpret the code as a number and the leading zeros are gone.
  foaie.getColumn(1).numFmt = FORMAT_TEXT
  foaie.getColumn(4).numFmt = FORMAT_CANTITATE

  foaie.getColumn(1).width = 14
  foaie.getColumn(2).width = 42
  foaie.getColumn(3).width = 8
  foaie.getColumn(4).width = 14

  return Buffer.from(await registru.xlsx.writeBuffer())
}

/**
 * Hash of what the file says, not of the file itself.
 *
 * Two exports of the same consumption produce different bytes — timestamps,
 * zip ordering — but the same hash here, which is what makes "has this already
 * been sent to SAGA?" answerable.
 */
export function hashContinut(randuri: readonly RandExport[]): string {
  const canonic = [...randuri]
    .sort((a, b) => a.codSaga.localeCompare(b.codSaga))
    .map((r) => `${r.codSaga}|${r.um}|${r.cantitate}`)
    .join('\n')

  return createHash('sha256').update(canonic, 'utf8').digest('hex')
}
