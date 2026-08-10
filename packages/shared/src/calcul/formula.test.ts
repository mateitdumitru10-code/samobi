import { describe, expect, it } from 'vitest'

import { EroareFormulaInvalida, EroareVariabilaNecunoscuta } from './erori.js'
import { evalueazaFormula, valideazaFormula } from './formula.js'

const SCOP = { L: 2000, l: 1600, H: 350 }

describe('valideazaFormula', () => {
  it('acceptă exemplul din spec', () => {
    const v = valideazaFormula('2*(L+l)/1000 * 0.10 * 0.025')
    expect([...v.variabile].sort()).toEqual(['L', 'l'])
    expect(v.foloseteInaltime).toBe(false)
  })

  it('recunoaște formulele care folosesc H', () => {
    expect(valideazaFormula('L*l*H/1000000000').foloseteInaltime).toBe(true)
  })

  it('acceptă funcțiile permise', () => {
    for (const f of ['min(L,l)', 'max(L,l)', 'ceil(L/1000)', 'floor(L/1000)', 'round(L/1000)']) {
      expect(() => valideazaFormula(f)).not.toThrow()
    }
    expect(evalueazaFormula('sqrt(L*l)/1000', SCOP).valoare.toFixed(4)).toBe('1.7889')
  })

  it('respinge o variabilă necunoscută', () => {
    expect(() => valideazaFormula('X*2')).toThrow(EroareVariabilaNecunoscuta)
  })

  it('tratează constantele ca variabile necunoscute, deci le respinge', () => {
    // PI și E sunt șterse din parser: o formulă trebuie să fie auditabilă.
    expect(() => valideazaFormula('PI*L')).toThrow(EroareVariabilaNecunoscuta)
    expect(() => valideazaFormula('E*L')).toThrow(EroareVariabilaNecunoscuta)
  })

  it('respinge funcțiile nepermise', () => {
    for (const f of ['sin(L)', 'random()', 'abs(L)', 'log(L)']) {
      expect(() => valideazaFormula(f)).toThrow()
    }
  })

  it('respinge operatorii nepermiși', () => {
    for (const f of ['L^2', 'L % 3', 'L > l', 'L and l', 'L ? 1 : 2']) {
      expect(() => valideazaFormula(f)).toThrow()
    }
  })

  it('respinge o formulă goală sau nesintactică', () => {
    expect(() => valideazaFormula('')).toThrow(EroareFormulaInvalida)
    expect(() => valideazaFormula('2*(L+')).toThrow(EroareFormulaInvalida)
  })

  it('respinge o formulă care nu produce un număr finit pe valorile de test', () => {
    expect(() => valideazaFormula('1/(L-L)')).toThrow(EroareFormulaInvalida)
  })

  it('permite minus unar', () => {
    expect(evalueazaFormula('-L/1000', SCOP).valoare.toString()).toBe('-2')
  })
})

describe('evalueazaFormula', () => {
  it('substituie valorile pentru audit', () => {
    const r = evalueazaFormula('2*(L+l)/1000', SCOP)
    expect(r.expresieEvaluata).toBe('2*(2000+1600)/1000')
    expect(r.valoare.toString()).toBe('7.2')
  })

  it('nu confundă variabila l cu litera l din numele funcțiilor', () => {
    const r = evalueazaFormula('floor(l/1000)', SCOP)
    expect(r.expresieEvaluata).toBe('floor(1600/1000)')
    expect(r.valoare.toString()).toBe('1')
  })

  it('curăță zgomotul IEEE de la trecerea float → Decimal', () => {
    // În float, 2*(2000+1600)/1000*0.10*0.025 = 0.018000000000000002.
    const r = evalueazaFormula('2*(L+l)/1000 * 0.10 * 0.025', SCOP)
    expect(r.valoare.toString()).toBe('0.018')
  })

  it('semnalează împărțirea la zero fără să arunce', () => {
    const r = evalueazaFormula('1/(L-2000)', SCOP)
    expect(r.esteNumar).toBe(false)
  })
})
