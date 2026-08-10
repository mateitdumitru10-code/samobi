import { describe, expect, it } from 'vitest'

import { calculeazaConsumuri } from './calculeaza.js'
import {
  EroareCantitateFixaLipsa,
  EroareGestiuneInconsistenta,
  EroareInaltimeLipsa,
  EroareMaterialNerezolvat,
  EroareRezultatNenumeric,
  EroareUmInconsistenta,
  EroareValoareLipsaPeDimensiune,
  EroareVariabilaNecunoscuta,
} from './erori.js'
import { DIM_2000x1600, DIM_FARA_INALTIME, linie, reteta } from './fixtures.js'

const FARA_ALEGERI = new Map<string, string>()

function calc(linii: Parameters<typeof reteta>[0], optiuni?: { cantitate?: string }) {
  return calculeazaConsumuri({
    reteta: reteta(linii),
    dimensiune: DIM_2000x1600,
    cantitateProdus: optiuni?.cantitate ?? '1',
    alegeriMateriale: FARA_ALEGERI,
  })
}

describe('modurile de calcul', () => {
  it('fixa folosește cantitatea constantă', () => {
    const r = calc([linie({ modCalcul: 'fixa', cantitateFixa: '4', um: 'BUC' })])
    expect(r.linii[0]?.cantitateBruta).toBe('4')
    expect(r.linii[0]?.sursa).toBe('fixa')
  })

  it('formula evaluează exemplul din spec', () => {
    // 2*(2000+1600)/1000 * 0.10 * 0.025 = 0.018 MC
    const r = calc([
      linie({ modCalcul: 'formula', formula: '2*(L+l)/1000 * 0.10 * 0.025', cantitateFixa: null }),
    ])
    expect(r.linii[0]?.cantitateNeta).toBe('0.018')
    expect(r.linii[0]?.contributii[0]?.formulaEvaluata).toBe(
      '2*(2000+1600)/1000 * 0.10 * 0.025',
    )
  })

  it('tabel ia valoarea de pe dimensiunea cerută', () => {
    const r = calc([
      linie({
        modCalcul: 'tabel',
        cantitateFixa: null,
        um: 'ML',
        valoriPeDimensiuni: [
          { dimensiuneId: 'dim-1', cantitate: '16', esteOverride: false },
          { dimensiuneId: 'dim-2', cantitate: '14', esteOverride: false },
        ],
      }),
    ])
    expect(r.linii[0]?.cantitateBruta).toBe('16')
    expect(r.linii[0]?.sursa).toBe('tabel')
  })

  it('tabel fără valoare pe dimensiune dă eroare, nu zero', () => {
    expect(() =>
      calc([linie({ modCalcul: 'tabel', cantitateFixa: null, valoriPeDimensiuni: [] })]),
    ).toThrow(EroareValoareLipsaPeDimensiune)
  })

  it('fixa fără cantitate dă eroare', () => {
    expect(() => calc([linie({ modCalcul: 'fixa', cantitateFixa: null })])).toThrow(
      EroareCantitateFixaLipsa,
    )
  })
})

describe('override', () => {
  it('bate formula, cu prioritate absolută', () => {
    const r = calc([
      linie({
        modCalcul: 'formula',
        formula: '2*(L+l)/1000 * 0.10 * 0.025',
        cantitateFixa: null,
        valoriPeDimensiuni: [{ dimensiuneId: 'dim-1', cantitate: '0.052', esteOverride: true }],
      }),
    ])
    expect(r.linii[0]?.cantitateNeta).toBe('0.052')
    expect(r.linii[0]?.sursa).toBe('override')
    expect(r.linii[0]?.contributii[0]?.formulaEvaluata).toBeNull()
  })

  it('bate și cantitatea fixă', () => {
    const r = calc([
      linie({
        modCalcul: 'fixa',
        cantitateFixa: '4',
        valoriPeDimensiuni: [{ dimensiuneId: 'dim-1', cantitate: '5', esteOverride: true }],
      }),
    ])
    expect(r.linii[0]?.cantitateNeta).toBe('5')
  })

  it('o valoare de tabel care nu e override nu se aplică peste o formulă', () => {
    const r = calc([
      linie({
        modCalcul: 'formula',
        formula: 'L/1000',
        cantitateFixa: null,
        valoriPeDimensiuni: [{ dimensiuneId: 'dim-1', cantitate: '99', esteOverride: false }],
      }),
    ])
    expect(r.linii[0]?.cantitateNeta).toBe('2')
  })
})

describe('procent de pierderi', () => {
  it('se aplică peste cantitatea netă', () => {
    // 0.018 * 1.08 = 0.01944
    const r = calc([
      linie({
        modCalcul: 'formula',
        formula: '2*(L+l)/1000 * 0.10 * 0.025',
        cantitateFixa: null,
        procentPierderi: '8',
      }),
    ])
    expect(r.linii[0]?.cantitateNeta).toBe('0.018')
    expect(r.linii[0]?.cantitateBruta).toBe('0.01944')
  })

  it('păstrează netul distinct de brut, pentru antecalculații', () => {
    const r = calc([linie({ modCalcul: 'fixa', cantitateFixa: '10', procentPierderi: '5' })])
    expect(r.linii[0]?.cantitateNeta).toBe('10')
    expect(r.linii[0]?.cantitateBruta).toBe('10.5')
  })
})

describe('cantitatea de produs', () => {
  it('multiplică și netul, și brutul', () => {
    const r = calc([linie({ modCalcul: 'fixa', cantitateFixa: '0.04', procentPierderi: '10' })], {
      cantitate: '7',
    })
    expect(r.linii[0]?.cantitateNeta).toBe('0.28')
    expect(r.linii[0]?.cantitateBruta).toBe('0.308')
  })

  it('respinge o cantitate de produs zero sau negativă', () => {
    expect(() => calc([linie()], { cantitate: '0' })).toThrow()
    expect(() => calc([linie()], { cantitate: '-1' })).toThrow()
  })
})

describe('agregare', () => {
  it('adună două linii cu același cod SAGA', () => {
    const r = calc([
      linie({ codSaga: '00016024', modCalcul: 'fixa', cantitateFixa: '0.02', um: 'MC' }),
      linie({ codSaga: '00016024', modCalcul: 'fixa', cantitateFixa: '0.03', um: 'MC' }),
    ])
    expect(r.linii).toHaveLength(1)
    expect(r.linii[0]?.cantitateBruta).toBe('0.05')
    expect(r.linii[0]?.contributii).toHaveLength(2)
    expect(r.linii[0]?.sursa).toBe('fixa')
  })

  it('marchează sursa ca agregat când liniile au surse diferite', () => {
    const r = calc([
      linie({ codSaga: '00016024', modCalcul: 'fixa', cantitateFixa: '1', um: 'MC' }),
      linie({
        codSaga: '00016024',
        modCalcul: 'formula',
        formula: 'L/1000',
        cantitateFixa: null,
        um: 'MC',
      }),
    ])
    expect(r.linii[0]?.sursa).toBe('agregat')
    expect(r.linii[0]?.cantitateBruta).toBe('3')
  })

  it('nu amestecă articole diferite', () => {
    const r = calc([
      linie({ codSaga: '00016024', cantitateFixa: '1' }),
      linie({ codSaga: '00024369', cantitateFixa: '2' }),
    ])
    expect(r.linii).toHaveLength(2)
  })

  it('respinge același articol cu unități de măsură diferite', () => {
    expect(() =>
      calc([
        linie({ codSaga: '00016024', um: 'MC', cantitateFixa: '1' }),
        linie({ codSaga: '00016024', um: 'MP', cantitateFixa: '1' }),
      ]),
    ).toThrow(EroareUmInconsistenta)
  })

  it('respinge același articol descărcat din gestiuni diferite', () => {
    expect(() =>
      calc([
        linie({ codSaga: '00016024', gestiuneDescarcare: 'MATERII PRIME', cantitateFixa: '1' }),
        linie({ codSaga: '00016024', gestiuneDescarcare: 'DEPOZIT 2', cantitateFixa: '1' }),
      ]),
    ).toThrow(EroareGestiuneInconsistenta)
  })
})

describe('linii variabile', () => {
  it('folosește codul ales la crearea bonului', () => {
    const l = linie({
      codSaga: null,
      esteVariabil: true,
      categorieVariabila: 'TEXTIL',
      um: 'ML',
      modCalcul: 'tabel',
      cantitateFixa: null,
      valoriPeDimensiuni: [{ dimensiuneId: 'dim-1', cantitate: '16', esteOverride: false }],
    })
    const r = calculeazaConsumuri({
      reteta: reteta([l]),
      dimensiune: DIM_2000x1600,
      cantitateProdus: '1',
      alegeriMateriale: new Map([[l.id, '00023684']]),
    })
    expect(r.linii[0]?.codSaga).toBe('00023684')
  })

  it('dă eroare dacă materialul nu a fost ales', () => {
    expect(() =>
      calc([
        linie({
          codSaga: null,
          esteVariabil: true,
          categorieVariabila: 'TEXTIL',
          modCalcul: 'fixa',
          cantitateFixa: '16',
        }),
      ]),
    ).toThrow(EroareMaterialNerezolvat)
  })

  it('agregă două linii variabile care primesc același material', () => {
    const a = linie({
      codSaga: null,
      esteVariabil: true,
      um: 'ML',
      modCalcul: 'fixa',
      cantitateFixa: '16',
    })
    const b = linie({
      codSaga: null,
      esteVariabil: true,
      um: 'ML',
      modCalcul: 'fixa',
      cantitateFixa: '2',
    })
    const r = calculeazaConsumuri({
      reteta: reteta([a, b]),
      dimensiune: DIM_2000x1600,
      cantitateProdus: '1',
      alegeriMateriale: new Map([
        [a.id, '00023684'],
        [b.id, '00023684'],
      ]),
    })
    expect(r.linii).toHaveLength(1)
    expect(r.linii[0]?.cantitateBruta).toBe('18')
  })
})

describe('erori de formulă la calcul', () => {
  it('variabilă necunoscută', () => {
    expect(() =>
      calc([linie({ modCalcul: 'formula', formula: 'X*2', cantitateFixa: null })]),
    ).toThrow(EroareVariabilaNecunoscuta)
  })

  it('împărțire la zero pe dimensiunea concretă', () => {
    // Trece validarea pe valorile de test (L=2000), cade pe dimensiunea reală.
    expect(() =>
      calculeazaConsumuri({
        reteta: reteta([
          linie({ modCalcul: 'formula', formula: '1/(L-1500)', cantitateFixa: null }),
        ]),
        dimensiune: { id: 'dim-3', cod: '1500x900', lungime: '1500', latime: '900', inaltime: null },
        cantitateProdus: '1',
        alegeriMateriale: FARA_ALEGERI,
      }),
    ).toThrow(EroareRezultatNenumeric)
  })

  it('formulă cu H pe o dimensiune fără înălțime', () => {
    expect(() =>
      calculeazaConsumuri({
        reteta: reteta([
          linie({ modCalcul: 'formula', formula: 'L*l*H/1000000000', cantitateFixa: null }),
        ]),
        dimensiune: DIM_FARA_INALTIME,
        cantitateProdus: '1',
        alegeriMateriale: FARA_ALEGERI,
      }),
    ).toThrow(EroareInaltimeLipsa)
  })
})

describe('precizie', () => {
  it('adună exact acolo unde float-ul ar greși', () => {
    // 0.1 + 0.2 dă 0.30000000000000004 în aritmetică IEEE.
    const r = calc([
      linie({ codSaga: '00016024', um: 'KG', cantitateFixa: '0.1' }),
      linie({ codSaga: '00016024', um: 'KG', cantitateFixa: '0.2' }),
    ])
    expect(r.linii[0]?.cantitateBruta).toBe('0.3')
  })

  it('aplică procentul de pierderi exact', () => {
    // 1.005 * 1.1 dă 1.1055000000000001 în float.
    const r = calc([linie({ cantitateFixa: '1.005', procentPierderi: '10' })])
    expect(r.linii[0]?.cantitateBruta).toBe('1.1055')
  })

  it('rotunjește o singură dată, la final', () => {
    // Trei linii de 0.0004: rotunjite individual ar da 0.000 fiecare, deci 0.
    const r = calc([
      linie({ codSaga: '00016024', um: 'KG', cantitateFixa: '0.0004' }),
      linie({ codSaga: '00016024', um: 'KG', cantitateFixa: '0.0004' }),
      linie({ codSaga: '00016024', um: 'KG', cantitateFixa: '0.0004' }),
    ])
    expect(r.linii[0]?.cantitateBruta).toBe('0.0012')
    expect(r.linii[0]?.cantitateBrutaRotunjita).toBe('0.001')
  })

  it('păstrează valoarea neroturnjită separat de cea de export', () => {
    const r = calc([linie({ cantitateFixa: '0.0255', procentPierderi: '7.5' })])
    expect(r.linii[0]?.cantitateBruta).toBe('0.0274125')
    expect(r.linii[0]?.cantitateBrutaRotunjita).toBe('0.027')
  })

  it('nu produce notație exponențială pentru valori mici', () => {
    const r = calc([linie({ cantitateFixa: '0.0000001' })])
    expect(r.linii[0]?.cantitateBruta).not.toContain('e')
  })
})

describe('reproductibilitate', () => {
  it('raportează versiunea de rețetă cu care s-a calculat', () => {
    const r = calc([linie()])
    expect(r.versiuneReteta).toBe(1)
    expect(r.retetaId).toBe('reteta-1')
    expect(r.dimensiuneId).toBe('dim-1')
  })
})
