import { describe, expect, it } from 'vitest'

import { calculeazaConsumuri, cantitatiPeLinie } from './calculeaza.js'
import { EroareValoareLipsaPeDimensiune } from './erori.js'
import { DIM_2000x1600, DIM_LA_COMANDA, linie, reteta } from './fixtures.js'
import { evalueazaFormula } from './formula.js'

/**
 * Step materials, and what a formula does at a size the recipe has never seen.
 *
 * A panel is bought whole and fabric comes off a roll of fixed width, so
 * consumption jumps rather than slides. `ceil` is how that is written, and it
 * is also where floating-point noise stops being harmless.
 */

describe('funcții în trepte — panouri și baloturi', () => {
  it('numără panouri întregi, cu saltul exact pe margine', () => {
    const laLungimea = (L: string) =>
      calculeazaConsumuri({
        reteta: reteta([linie({ modCalcul: 'formula', formula: 'ceil(L/2800)', um: 'BUC' })]),
        dimensiune: { ...DIM_2000x1600, lungime: L },
        cantitateProdus: '1',
        alegeriMateriale: new Map(),
      }).linii[0]?.cantitateBrutaRotunjita

    expect(laLungimea('2800')).toBe('1.000')
    expect(laLungimea('2801')).toBe('2.000')
  })

  it('nu lasă zgomotul IEEE să cumpere un panou în plus', () => {
    // Without snapping the argument this is Math.ceil(3.0000000000000004) = 4,
    // which is one whole extra sheet of PAL booked into SAGA.
    const scop = { L: 100, l: 200, H: null }
    expect(evalueazaFormula('ceil((L/1000 + l/1000) * 10)', scop).valoare.toString()).toBe('3')
    expect(evalueazaFormula('floor((L/1000 + l/1000) * 10)', scop).valoare.toString()).toBe('3')
  })

  it('aplică pierderile peste rezultatul în trepte, fără rotunjire intermediară', () => {
    const rezultat = calculeazaConsumuri({
      reteta: reteta([
        linie({ modCalcul: 'formula', formula: 'ceil(l/1400)', um: 'BUC', procentPierderi: '8' }),
      ]),
      dimensiune: { ...DIM_2000x1600, latime: '1500' },
      cantitateProdus: '1',
      alegeriMateriale: new Map(),
    })
    expect(rezultat.linii[0]?.cantitateNeta).toBe('2')
    expect(rezultat.linii[0]?.cantitateBruta).toBe('2.16')
    expect(rezultat.linii[0]?.cantitateBrutaRotunjita).toBe('2.160')
  })
})

describe('urma lăsată de calcul', () => {
  it('păstrează formula scrisă alături de expresia evaluată', () => {
    const rezultat = calculeazaConsumuri({
      reteta: reteta([linie({ modCalcul: 'formula', formula: 'L*l/1000000', um: 'MP' })]),
      dimensiune: DIM_2000x1600,
      cantitateProdus: '1',
      alegeriMateriale: new Map(),
    })
    const contributie = rezultat.linii[0]?.contributii[0]
    expect(contributie?.formulaEvaluata).toBe('2000*1600/1000000')
    // The recipe is edited in place now, so the bon has to stand alone.
    expect(contributie?.formula).toBe('L*l/1000000')
  })

  it('întoarce dimensiunea folosită, nu doar identificatorul ei', () => {
    const rezultat = calculeazaConsumuri({
      reteta: reteta([linie({ cantitateFixa: '4', um: 'BUC' })]),
      dimensiune: DIM_2000x1600,
      cantitateProdus: '1',
      alegeriMateriale: new Map(),
    })
    expect(rezultat.dimensiune.lungime).toBe('2000')
    expect(rezultat.dimensiune.inaltime).toBe('350')
  })
})

describe('proba pe o dimensiune neînregistrată', () => {
  const cuTabel = reteta([
    linie({ modCalcul: 'formula', formula: 'L*l/1000000', um: 'MP' }),
    linie({ modCalcul: 'tabel', um: 'ML', grup: 'TAPITERIE', codSaga: '00023112' }),
  ])

  it('calculează formulele și lasă tabelul să spună de ce nu poate', () => {
    // The comparison panel's trial size: a recipe half of which cannot be
    // computed there must still show the half that can.
    const linii = cantitatiPeLinie(cuTabel, DIM_LA_COMANDA)

    expect(linii[0]?.cantitate).toBe('3.1175')
    expect(linii[1]?.cantitate).toBeNull()
    expect(linii[1]?.motiv).toMatch(/tabel/)
  })

  it('un bon pe mod tabel fără valoare este refuzat, nu pus pe zero', () => {
    expect(() =>
      calculeazaConsumuri({
        reteta: cuTabel,
        dimensiune: DIM_2000x1600,
        cantitateProdus: '1',
        alegeriMateriale: new Map(),
      }),
    ).toThrow(EroareValoareLipsaPeDimensiune)
  })
})
