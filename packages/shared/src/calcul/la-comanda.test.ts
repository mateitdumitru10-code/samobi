import { describe, expect, it } from 'vitest'

import { calculeazaConsumuri } from './calculeaza.js'
import {
  EroareDimensiuneInAfaraIntervalului,
  EroareDimensiuneLaComandaNepermisa,
  EroareInaltimeLipsa,
  EroareRezultatNenumeric,
  EroareValoareLipsaPeDimensiune,
  EroareValoareManualaLipsa,
} from './erori.js'
import { DIM_2000x1600, DIM_LA_COMANDA, INTERVAL, linie, reteta } from './fixtures.js'
import { evalueazaFormula, valideazaFormulaPeInterval } from './formula.js'

/**
 * Made-to-order sizes.
 *
 * The whole feature rests on the engine refusing three things: a size the model
 * was never opened to, a table value it would have to invent, and a formula
 * that stops making sense at the edge of the declared range. Everything else is
 * arithmetic that already worked.
 */

function calc(over: Partial<Parameters<typeof calculeazaConsumuri>[0]> = {}) {
  return calculeazaConsumuri({
    reteta: reteta([linie({ modCalcul: 'formula', formula: 'L*l/1000000', um: 'MP' })]),
    dimensiune: DIM_LA_COMANDA,
    cantitateProdus: '1',
    alegeriMateriale: new Map(),
    interval: INTERVAL,
    ...over,
  })
}

describe('intervalul de dimensiuni', () => {
  it('acceptă o dimensiune în interval, inclusiv exact pe capete', () => {
    expect(calc().linii[0]?.cantitateBrutaRotunjita).toBe('3.118')

    const peCapat = calc({
      dimensiune: { ...DIM_LA_COMANDA, lungime: '1800', latime: '800', inaltime: '300' },
    })
    expect(peCapat.linii[0]?.cantitateBrutaRotunjita).toBe('1.440')
  })

  it('refuză un milimetru peste maxim, numind axa', () => {
    expect(() => calc({ dimensiune: { ...DIM_LA_COMANDA, lungime: '2201' } })).toThrow(
      EroareDimensiuneInAfaraIntervalului,
    )

    try {
      calc({ dimensiune: { ...DIM_LA_COMANDA, latime: '799' } })
      expect.unreachable('trebuia să refuze')
    } catch (err) {
      expect(err).toBeInstanceOf(EroareDimensiuneInAfaraIntervalului)
      expect((err as Error).message).toContain('Lățime')
      expect((err as Error).message).toContain('800–2000')
    }
  })

  it('refuză o dimensiune la comandă pe un model fără interval declarat', () => {
    expect(() => calc({ interval: null })).toThrow(EroareDimensiuneLaComandaNepermisa)
    expect(() => calc({ interval: undefined })).toThrow(EroareDimensiuneLaComandaNepermisa)
  })

  it('nu aplică intervalul dimensiunilor înregistrate', () => {
    // A registered dimension is itself the decision that the model can be built
    // that way; the interval is about sizes nobody looked at.
    const rezultat = calculeazaConsumuri({
      reteta: reteta([linie({ cantitateFixa: '4', um: 'BUC' })]),
      dimensiune: { ...DIM_2000x1600, lungime: '9999' },
      cantitateProdus: '1',
      alegeriMateriale: new Map(),
      interval: null,
    })
    expect(rezultat.linii[0]?.cantitateBrutaRotunjita).toBe('4.000')
  })

  it('sare peste axa pe care modelul nu o folosește', () => {
    const rezultat = calc({
      dimensiune: { ...DIM_LA_COMANDA, inaltime: null },
      reteta: reteta([linie({ modCalcul: 'formula', formula: 'L*l/1000000', um: 'MP' })]),
      interval: { ...INTERVAL, inaltimeMin: null, inaltimeMax: null },
    })
    expect(rezultat.linii).toHaveLength(1)
  })
})

describe('liniile pe mod tabel la o dimensiune la comandă', () => {
  const cuTabel = reteta([
    linie({ modCalcul: 'tabel', um: 'ML', grup: 'TAPITERIE', codSaga: '00023112' }),
    linie({ modCalcul: 'tabel', um: 'MP', grup: 'AMBALAJ', codSaga: '00000031' }),
  ])

  it('refuză, și le numește pe toate deodată', () => {
    try {
      calc({ reteta: cuTabel })
      expect.unreachable('trebuia să refuze')
    } catch (err) {
      expect(err).toBeInstanceOf(EroareValoareManualaLipsa)
      // Not just the first: being sent back for the next number after typing
      // the previous one is how a form loses a person.
      expect((err as EroareValoareManualaLipsa).linii).toHaveLength(2)
    }
  })

  it('acceptă valoarea introdusă la bon și o marchează ca atare', () => {
    const linii = cuTabel.linii
    const rezultat = calc({
      reteta: cuTabel,
      valoriManuale: new Map([
        [linii[0]?.id ?? '', '15.5'],
        [linii[1]?.id ?? '', '6.25'],
      ]),
    })

    const tapiterie = rezultat.linii.find((l) => l.codSaga === '00023112')
    expect(tapiterie?.sursa).toBe('manual')
    expect(tapiterie?.cantitateBrutaRotunjita).toBe('15.500')
  })

  it('nu lasă o valoare manuală să ascundă un tabel de pe o dimensiune înregistrată', () => {
    const l = linie({
      modCalcul: 'tabel',
      um: 'ML',
      valoriPeDimensiuni: [{ dimensiuneId: DIM_2000x1600.id, cantitate: '16', esteOverride: false }],
    })
    const rezultat = calculeazaConsumuri({
      reteta: reteta([l]),
      dimensiune: DIM_2000x1600,
      cantitateProdus: '1',
      alegeriMateriale: new Map(),
      valoriManuale: new Map([[l.id, '99']]),
    })
    expect(rezultat.linii[0]?.cantitateBrutaRotunjita).toBe('16.000')
    expect(rezultat.linii[0]?.sursa).toBe('tabel')
  })

  it('păstrează eroarea veche pe o dimensiune înregistrată fără valoare', () => {
    expect(() =>
      calculeazaConsumuri({
        reteta: reteta([linie({ modCalcul: 'tabel', um: 'ML' })]),
        dimensiune: DIM_2000x1600,
        cantitateProdus: '1',
        alegeriMateriale: new Map(),
      }),
    ).toThrow(EroareValoareLipsaPeDimensiune)
  })
})

describe('formule la dimensiuni la comandă', () => {
  it('substituie dimensiunile cerute în expresia păstrată pentru audit', () => {
    const rezultat = calc()
    const contributie = rezultat.linii[0]?.contributii[0]
    expect(contributie?.formulaEvaluata).toBe('2150*1450/1000000')
    // The formula as written travels with the bon: the recipe it came from is
    // a draft that can be rewritten tomorrow.
    expect(contributie?.formula).toBe('L*l/1000000')
  })

  it('refuză o împărțire la zero produsă chiar de dimensiunea cerută', () => {
    expect(() =>
      calc({ reteta: reteta([linie({ modCalcul: 'formula', formula: 'L/(l-1450)', um: 'ML' })]) }),
    ).toThrow(EroareRezultatNenumeric)
  })

  it('refuză o formulă cu H pe o dimensiune fără înălțime', () => {
    expect(() =>
      calc({
        dimensiune: { ...DIM_LA_COMANDA, inaltime: null },
        interval: { ...INTERVAL, inaltimeMin: null, inaltimeMax: null },
        reteta: reteta([linie({ modCalcul: 'formula', formula: 'H/1000', um: 'ML' })]),
      }),
    ).toThrow(EroareInaltimeLipsa)
  })

  it('snapshotează dimensiunile folosite în rezultat', () => {
    const rezultat = calc()
    expect(rezultat.dimensiuneId).toBeNull()
    expect(rezultat.dimensiune.lungime).toBe('2150')
    expect(rezultat.dimensiune.inaltime).toBe('400')
  })
})

describe('funcții în trepte — panouri și baloturi', () => {
  it('numără panouri întregi, cu saltul exact pe margine', () => {
    const laLungimea = (L: string) =>
      calc({
        dimensiune: { ...DIM_LA_COMANDA, lungime: L },
        reteta: reteta([linie({ modCalcul: 'formula', formula: 'ceil(L/2800)', um: 'BUC' })]),
      }).linii[0]?.cantitateBrutaRotunjita

    expect(laLungimea('2200')).toBe('1.000')
    expect(laLungimea('1800')).toBe('1.000')
  })

  it('nu lasă zgomotul IEEE să cumpere un panou în plus', () => {
    // Without snapping this is Math.ceil(3.0000000000000004) = 4.
    expect(evalueazaFormula('ceil((L/1000 + l/1000) * 10)', { L: 100, l: 200, H: null }).valoare.toString()).toBe('3')
    expect(evalueazaFormula('floor((L/1000 + l/1000) * 10)', { L: 100, l: 200, H: null }).valoare.toString()).toBe('3')
  })

  it('aplică pierderile peste rezultatul în trepte, fără rotunjire intermediară', () => {
    const rezultat = calc({
      dimensiune: { ...DIM_LA_COMANDA, latime: '1500' },
      reteta: reteta([
        linie({ modCalcul: 'formula', formula: 'ceil(l/1400)', um: 'BUC', procentPierderi: '8' }),
      ]),
    })
    expect(rezultat.linii[0]?.cantitateNeta).toBe('2')
    expect(rezultat.linii[0]?.cantitateBruta).toBe('2.16')
    expect(rezultat.linii[0]?.cantitateBrutaRotunjita).toBe('2.160')
  })
})

describe('validarea formulelor pe tot intervalul', () => {
  const interval = {
    lungimeMin: 1800,
    lungimeMax: 2200,
    latimeMin: 800,
    latimeMax: 2000,
    inaltimeMin: 300,
    inaltimeMax: 450,
  }

  it('acceptă o formulă finită și pozitivă în toate colțurile', () => {
    expect(valideazaFormulaPeInterval('L*l/1000000', interval)).toEqual([])
  })

  it('prinde o formulă care e bună la mijloc și moare la margine', () => {
    // Passes at the single test point (2000×1600) and divides by zero at l=800.
    const rele = valideazaFormulaPeInterval('L/(l-800)', interval)
    expect(rele.length).toBeGreaterThan(0)
    expect(rele.some((p) => p.l === 800)).toBe(true)
  })

  it('prinde o formulă care ajunge la zero sau sub zero', () => {
    const rele = valideazaFormulaPeInterval('(l-1000)/1000', interval)
    expect(rele.some((p) => p.l === 800)).toBe(true)
  })

  it('nu cere înălțimi pentru o formulă care nu folosește H', () => {
    const rele = valideazaFormulaPeInterval('L/1000', {
      ...interval,
      inaltimeMin: null,
      inaltimeMax: null,
    })
    expect(rele).toEqual([])
  })
})
