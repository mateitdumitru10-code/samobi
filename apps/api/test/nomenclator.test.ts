import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { agregaArticole } from '../src/nomenclator/agregare.js'
import { citesteNomenclator } from '../src/nomenclator/citire.js'

/**
 * Reading and collapsing the SAGA export. No database involved: these are the
 * decisions that turn a stock report into a catalogue, and they are worth
 * testing on their own.
 */

interface Rand {
  den_gest?: string
  denumire?: string
  cod_art?: string | number
  um?: string
  den_tip?: string
  cant_fin?: number
  pret_mediu?: number
  cont?: string
}

const COLOANE = [
  'den_gest',
  'denumire',
  'cod_art',
  'um',
  'den_tip',
  'cant_fin',
  'pret_mediu',
  'cont',
] as const

async function fisier(randuri: Rand[], optiuni: { titlu?: boolean } = {}): Promise<Buffer> {
  const registru = new ExcelJS.Workbook()
  const foaie = registru.addWorksheet('SituatiiStocuri')

  if (optiuni.titlu === true) foaie.addRow(['SITUATIE STOCURI LA ZI'])
  foaie.addRow([...COLOANE])
  for (const rand of randuri) {
    foaie.addRow(COLOANE.map((c) => rand[c] ?? ''))
  }

  const iesire = await registru.xlsx.writeBuffer()
  return Buffer.from(iesire)
}

describe('citirea exportului SAGA', () => {
  it('reconstituie codul când Excel l-a livrat ca număr', async () => {
    const randuri = citesteNomenclator(
      await fisier([{ cod_art: 16024, denumire: 'CHERESTEA TIVITA FAG', um: 'MC', cont: '301' }]),
    )
    expect(randuri[0]?.cod).toBe('00016024')
  })

  it('găsește antetul chiar dacă exportul are un titlu deasupra', async () => {
    const randuri = citesteNomenclator(
      await fisier([{ cod_art: '00023684', denumire: 'TOSCANA 247', um: 'ML' }], { titlu: true }),
    )
    expect(randuri).toHaveLength(1)
    expect(randuri[0]?.denumire).toBe('TOSCANA 247')
  })

  it('normalizează UM-ul fără să piardă scrierea originală', async () => {
    const randuri = citesteNomenclator(
      await fisier([{ cod_art: '00000018', denumire: 'CANT PAL', um: '  BUC' }]),
    )
    expect(randuri[0]?.um).toBe('BUC')
    expect(randuri[0]?.umNormalizat).toBe('BUC')
  })

  it('clasifică după cont, nu după eticheta liberă', async () => {
    const randuri = citesteNomenclator(
      await fisier([
        { cod_art: '00022107', denumire: 'PAT DAVID', um: 'BUC', cont: '345', den_tip: 'Marfuri' },
      ]),
    )
    expect(randuri[0]?.tip).toBe('produs')
    expect(randuri[0]?.tipSaga).toBe('Marfuri')
  })

  it('sare peste rândurile fără cod sau fără denumire', async () => {
    const randuri = citesteNomenclator(
      await fisier([
        { cod_art: '00000018', denumire: 'CANT PAL', um: 'ML' },
        { cod_art: '', denumire: 'FĂRĂ COD', um: 'ML' },
        { cod_art: '00000019', denumire: '', um: 'ML' },
      ]),
    )
    expect(randuri).toHaveLength(1)
  })

  it('refuză un fișier fără antetul așteptat', async () => {
    const registru = new ExcelJS.Workbook()
    registru.addWorksheet('Foaie').addRow(['ceva', 'altceva'])
    const gol = Buffer.from(await registru.xlsx.writeBuffer())
    expect(() => citesteNomenclator(gol)).toThrow(/antetul/i)
  })
})

describe('agregarea pe articol', () => {
  it('alege gestiunea care are stoc', async () => {
    const randuri = citesteNomenclator(
      await fisier([
        { cod_art: '00000023', denumire: 'CAPSE 380/14', um: 'BUC', den_gest: 'MARFA BUZAU', cant_fin: 0 },
        { cod_art: '00000023', denumire: 'CAPSE 380/14', um: 'BUC', den_gest: 'MATERII PRIME', cant_fin: 370.1 },
      ]),
    )
    const articole = agregaArticole(randuri)
    expect(articole).toHaveLength(1)
    expect(articole[0]?.gestiuneImplicita).toBe('MATERII PRIME')
  })

  it('preferă MATERII PRIME când nicăieri nu există stoc', async () => {
    const randuri = citesteNomenclator(
      await fisier([
        { cod_art: '00000026', denumire: 'CAPSE 92/35', um: 'BUC', den_gest: 'MARFA SEDIU', cant_fin: 0 },
        { cod_art: '00000026', denumire: 'CAPSE 92/35', um: 'BUC', den_gest: 'MATERII PRIME', cant_fin: 0 },
      ]),
    )
    expect(agregaArticole(randuri)[0]?.gestiuneImplicita).toBe('MATERII PRIME')
  })

  it('ia cel mai mare preț mediu nenul dintre gestiuni', async () => {
    // O gestiune fără stoc raportează preț zero; luat ca atare, ar face
    // antecalculația să iasă gratis.
    const randuri = citesteNomenclator(
      await fisier([
        { cod_art: '00000018', denumire: 'CANT PAL', um: 'ML', den_gest: 'MATERII PRIME', cant_fin: 0, pret_mediu: 0 },
        { cod_art: '00000018', denumire: 'CANT PAL', um: 'ML', den_gest: 'MARFA CONSTANTA', cant_fin: 3, pret_mediu: 384.03 },
      ]),
    )
    expect(agregaArticole(randuri)[0]?.pretReferinta).toBe('384.03')
  })

  it('produce același rezultat la fiecare rulare', async () => {
    const continut = await fisier([
      { cod_art: '00000031', denumire: 'CARTON MUCAVA', um: 'BUC', den_gest: 'MARFA SEDIU', cant_fin: 0 },
      { cod_art: '00000031', denumire: 'CARTON MUCAVA', um: 'BUC', den_gest: 'MARFA BUZAU', cant_fin: 0 },
    ])
    const unu = agregaArticole(citesteNomenclator(continut))
    const doi = agregaArticole(citesteNomenclator(continut))
    expect(unu).toEqual(doi)
    expect(unu[0]?.gestiuneImplicita).toBe('MARFA BUZAU')
  })
})
