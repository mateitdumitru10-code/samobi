import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { ANTET, hashContinut, NUME_FOAIE, scrieExport } from '../src/export/xlsx.js'
import { citesteXlsx } from '../src/nomenclator/xlsx.js'
import { citesteFisier } from '../src/nomenclator/zip.js'

/**
 * The export is the whole point of the application, and the leading zeros are
 * the part that silently breaks it. These tests read the generated file back
 * rather than trusting that it was written correctly.
 */

const RANDURI = [
  { codSaga: '00023684', denumire: 'TOSCANA 247', um: 'ML', cantitate: '16.000' },
  { codSaga: '00016024', denumire: 'CHERESTEA TIVITA FAG', um: 'MC', cantitate: '0.040' },
  { codSaga: '00000018', denumire: 'CANT PAL', um: 'ML', cantitate: '1.234' },
]

describe('fișierul de import pentru SAGA', () => {
  it('păstrează zerourile din fața codului', async () => {
    const continut = await scrieExport(RANDURI)

    const registru = new ExcelJS.Workbook()
    await registru.xlsx.load(continut as unknown as Parameters<typeof registru.xlsx.load>[0])
    const foaie = registru.getWorksheet(NUME_FOAIE)

    expect(foaie?.getRow(2).getCell(1).value).toBe('00023684')
    expect(foaie?.getRow(3).getCell(1).value).toBe('00016024')
    expect(foaie?.getRow(4).getCell(1).value).toBe('00000018')
  })

  it('scrie codul ca text, nu ca număr', async () => {
    const continut = await scrieExport(RANDURI)
    const foaie = citesteXlsx(continut)

    // Cititorul propriu ignoră formatarea și vede valoarea brută din XML.
    expect(foaie.randuri[1]?.[0]).toBe('00023684')
    expect(foaie.randuri[1]?.[0]).not.toBe('23684')
  })

  it('aplică formatul text pe coloana de cod', async () => {
    const continut = await scrieExport(RANDURI)
    const stiluri = citesteFisier(continut, 'xl/styles.xml') ?? ''

    // numFmtId 49 este formatul incorporat '@'. Fără el, Excel reinterpretează
    // codul ca număr și zerourile dispar la prima deschidere.
    expect(stiluri).toMatch(/numFmtId="49"/)
  })

  it('are exact antetul pe care îl așteaptă SAGA', async () => {
    const continut = await scrieExport(RANDURI)
    const foaie = citesteXlsx(continut)

    expect(foaie.nume).toBe(NUME_FOAIE)
    expect(foaie.randuri[0]).toEqual([...ANTET])
  })

  it('scrie cantitatea cu trei zecimale', async () => {
    const continut = await scrieExport(RANDURI)
    const registru = new ExcelJS.Workbook()
    await registru.xlsx.load(continut as unknown as Parameters<typeof registru.xlsx.load>[0])
    const foaie = registru.getWorksheet(NUME_FOAIE)

    expect(foaie?.getColumn(4).numFmt).toBe('0.000')
    expect(foaie?.getRow(3).getCell(4).value).toBe(0.04)
  })

  it('nu pierde codurile care încep cu literă', async () => {
    const continut = await scrieExport([
      { codSaga: 'T0006460', denumire: 'LIVING OSCAR', um: 'BUC', cantitate: '1.000' },
    ])
    expect(citesteXlsx(continut).randuri[1]?.[0]).toBe('T0006460')
  })
})

describe('hash-ul de conținut', () => {
  it('nu depinde de ordinea rândurilor', () => {
    const invers = [...RANDURI].reverse()
    expect(hashContinut(RANDURI)).toBe(hashContinut(invers))
  })

  it('se schimbă când se schimbă o cantitate', () => {
    const modificat = RANDURI.map((r) =>
      r.codSaga === '00023684' ? { ...r, cantitate: '16.001' } : r,
    )
    expect(hashContinut(RANDURI)).not.toBe(hashContinut(modificat))
  })

  it('nu se schimbă între două generări ale aceluiași conținut', () => {
    expect(hashContinut(RANDURI)).toBe(hashContinut([...RANDURI]))
  })
})

describe('unitatea de măsură din export', () => {
  it('nu scrie niciodată o celulă de UM goală', async () => {
    // O celulă goală aici e motivul pentru care SAGA a respins un bon real:
    // articolul are UM gol în nomenclator, iar `??` nu prinde șirul vid.
    const continut = await scrieExport([
      { codSaga: '00000662', denumire: 'CUIE', um: 'MIIB', cantitate: '0.100' },
    ])
    const foaie = citesteXlsx(continut)
    expect(foaie.randuri[1]?.[2]).toBe('MIIB')
    expect(foaie.randuri[1]?.[2]).not.toBe('')
  })
})
