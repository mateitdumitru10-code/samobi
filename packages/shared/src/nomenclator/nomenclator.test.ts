import { describe, expect, it } from 'vitest'

import { normalizeazaCodSaga } from './coduri.js'
import {
  normalizeazaDenumire,
  numereDin,
  potrivireSigura,
  scorSimilaritate,
  sugereaza,
} from './similaritate.js'
import { determinaTip, tipDupaCont, tipDupaDenumire } from './tip.js'
import { esteUmCunoscuta, normalizeazaUm } from './um.js'

describe('coduri SAGA', () => {
  it('reconstituie zerourile pierdute de Excel', () => {
    expect(normalizeazaCodSaga(16024)).toBe('00016024')
    expect(normalizeazaCodSaga('16024')).toBe('00016024')
    expect(normalizeazaCodSaga(18)).toBe('00000018')
  })

  it('lasă neatins un cod care are deja 8 caractere', () => {
    expect(normalizeazaCodSaga('00016024')).toBe('00016024')
  })

  it('nu completează codurile care conțin litere', () => {
    // Codurile care încep cu T există în nomenclator; Excel nu le-a stricat.
    expect(normalizeazaCodSaga('T0006459')).toBe('T0006459')
    expect(normalizeazaCodSaga('t0006459')).toBe('T0006459')
  })

  it('tratează golul ca lipsă, nu ca zero', () => {
    expect(normalizeazaCodSaga('')).toBeNull()
    expect(normalizeazaCodSaga('   ')).toBeNull()
    expect(normalizeazaCodSaga(null)).toBeNull()
    expect(normalizeazaCodSaga(undefined)).toBeNull()
  })
})

describe('unități de măsură', () => {
  it('curăță spațiile și diferențele de scriere', () => {
    expect(normalizeazaUm('  BUC')).toBe('BUC')
    expect(normalizeazaUm(' buc ')).toBe('BUC')
    expect(normalizeazaUm(' ML')).toBe('ML')
  })

  it('unifică variantele reale din nomenclator', () => {
    for (const variantă of ['B', 'BC', 'BCU', 'BIUC', 'BYC', 'BUC`', 'PCS']) {
      expect(normalizeazaUm(variantă)).toBe('BUC')
    }
    for (const variantă of ['MII B', 'MIIBU', 'MII', '1000B', 'MBUC']) {
      expect(normalizeazaUm(variantă)).toBe('MIIB')
    }
    for (const variantă of ['SUTE', '100BU', '100B', '100 B', 'B100']) {
      expect(normalizeazaUm(variantă)).toBe('SUTEB')
    }
    expect(normalizeazaUm('M2')).toBe('MP')
    expect(normalizeazaUm('M3')).toBe('MC')
  })

  it('nu ghicește acolo unde intenția e ambiguă', () => {
    // 'M' poate fi metru sau metru liniar. Rămâne cum e, nu inventăm.
    expect(normalizeazaUm('M')).toBe('M')
    expect(normalizeazaUm('GAL')).toBe('GAL')
  })

  it('tratează UM-ul gol ca lipsă', () => {
    expect(normalizeazaUm('')).toBeNull()
    expect(normalizeazaUm(null)).toBeNull()
  })

  it('recunoaște unitățile pe care aplicația le înțelege', () => {
    expect(esteUmCunoscuta(normalizeazaUm('  BUC'))).toBe(true)
    expect(esteUmCunoscuta(normalizeazaUm('CURSA'))).toBe(false)
    expect(esteUmCunoscuta(null)).toBe(false)
  })
})

describe('tipul articolului', () => {
  it('clasifică după contul contabil', () => {
    expect(tipDupaCont('345')).toBe('produs')
    expect(tipDupaCont('371')).toBe('marfa')
    expect(tipDupaCont('301')).toBe('materie_prima')
    expect(tipDupaCont('3028')).toBe('materie_prima')
    expect(tipDupaCont('301.01')).toBe('materie_prima')
    expect(tipDupaCont('381')).toBe('materie_prima')
    expect(tipDupaCont('303')).toBe('altele')
    expect(tipDupaCont('231.4')).toBe('altele')
    expect(tipDupaCont('2131')).toBe('altele')
  })

  it('cade pe denumire când contul lipsește', () => {
    expect(determinaTip(null, 'Materii prime')).toBe('materie_prima')
    expect(determinaTip('', 'Produse finite')).toBe('produs')
    expect(determinaTip(undefined, 'Marfuri')).toBe('marfa')
    expect(determinaTip(null, 'Imobilizari in curs')).toBe('altele')
  })

  it('preferă contul denumirii', () => {
    // Denumirea zice marfă, contul zice produs finit. Contul câștigă.
    expect(determinaTip('345', 'Marfuri')).toBe('produs')
  })

  it('nu lasă nimic neclasificat', () => {
    expect(determinaTip(null, null)).toBe('altele')
    expect(tipDupaDenumire('ceva ce nu există')).toBe('altele')
  })
})

describe('sugestii pentru materiale nemapate', () => {
  const catalog = [
    { codSaga: '00023684', denumire: 'TOSCANA 247' },
    { codSaga: '00023879', denumire: 'TOSCANA 257' },
    { codSaga: '00016024', denumire: 'CHERESTEA TIVITA FAG' },
    { codSaga: '00024369', denumire: 'CHERESTEA TIVITA PIN' },
    { codSaga: '00000023', denumire: 'CAPSE 380/14' },
  ]

  it('dă scor maxim potrivirii exacte', () => {
    expect(scorSimilaritate('TOSCANA 247', 'TOSCANA 247')).toBe(1)
  })

  it('ignoră diacriticele, punctuația și scrierea cu litere mici', () => {
    expect(scorSimilaritate('capse 380/14', 'CAPSE 380-14')).toBe(1)
  })

  it('găsește articolul potrivit pentru o denumire de pe fișa scanată', () => {
    const [primul] = sugereaza('CHERESTEA FAG', catalog)
    expect(primul?.codSaga).toBe('00016024')
  })

  it('pune varianta corectă înaintea celei apropiate', () => {
    const rezultate = sugereaza('TOSCANA 257', catalog)
    expect(rezultate[0]?.codSaga).toBe('00023879')
    expect(rezultate[1]?.codSaga).toBe('00023684')
  })

  it('nu întoarce nimic pentru o denumire fără legătură', () => {
    expect(sugereaza('MOTOR ELECTRIC TRIFAZAT', catalog)).toHaveLength(0)
  })

  it('respectă limita cerută', () => {
    expect(sugereaza('CHERESTEA TIVITA', catalog, { limita: 1 })).toHaveLength(1)
  })
})

describe('separatori de dimensiuni', () => {
  it('tratează x, × și * la fel între cifre', () => {
    expect(normalizeazaDenumire('POL.2538 1900x680x40')).toBe('POL 2538 1900 680 40')
    expect(normalizeazaDenumire('POLIURETAN 2538 1900*680*40')).toBe('POLIURETAN 2538 1900 680 40')
    expect(normalizeazaDenumire('PLASA BONELL 186×60×13')).toBe('PLASA BONELL 186 60 13')
  })

  it('apropie fișa scanată de denumirea din nomenclator', () => {
    const scor = scorSimilaritate('POL.2538 1900x680x40', 'POLIURETAN 2538 1900*680*40')
    expect(scor).toBeGreaterThan(0.7)
  })

  it('nu strică un X care face parte dintr-un cuvânt', () => {
    expect(normalizeazaDenumire('BOX SPRING')).toBe('BOX SPRING')
  })
})

describe('când o potrivire se poate accepta fără om', () => {
  const sigura = (a: string, b: string) => potrivireSigura(a, b, scorSimilaritate(a, b))

  it('acceptă când toate cifrele coincid', () => {
    expect(sigura('POL.2538 1900x680x40', 'POLIURETAN 2538 1900*680*40')).toBe(true)
    expect(sigura('FELTRU 1000 GR', 'FELTRU 1000GR')).toBe(true)
    expect(sigura('PLASA BONELL 186x66x13', 'PLASA BONNELL 186X66X13CM')).toBe(true)
    expect(sigura('VATELINA 100 GR', 'VATELINA 100GR')).toBe(true)
  })

  it('refuză când cifrele diferă, oricât de asemănătoare ar fi literele', () => {
    expect(sigura('CAPSE 38/12', 'CAPSE 80/12')).toBe(false)
    expect(sigura('HSURUB 5/20', 'HOLSURUB 2.5X20')).toBe(false)
    expect(sigura('HDF MELAM 2.5 MM ALB', 'MDF MELAM 2 FETE 10MM ALB')).toBe(false)
  })

  it('refuză o denumire fără cifre, oricât de apropiată', () => {
    // Vaselină în loc de vatelină: exact greșeala pe care nicio euristică nu o prinde.
    expect(sigura('VATELINA', 'VASELINA')).toBe(false)
    expect(sigura('CHER FAG', 'CHERESTEA FAG')).toBe(false)
    expect(sigura('AMESTEC FIBRA', 'AMESTEC FULGI + FIBRA')).toBe(false)
  })

  it('acceptă potrivirea identică', () => {
    expect(sigura('CAPSE 92/35', 'CAPSE 92/35')).toBe(true)
    expect(sigura('ADEZIV', 'ADEZIV')).toBe(true)
  })

  it('extrage cifrele în ordine', () => {
    expect(numereDin('POL.2538 1900x680x40')).toEqual(['2538', '1900', '680', '40'])
    expect(numereDin('ADEZIV')).toEqual([])
  })
})
