import { describe, expect, it } from 'vitest'

import type { RandStoc } from '../saga/client.js'

import { deduplicheaza, separaNecunoscute } from './sincronizare.js'

/**
 * The two decisions taken before anything is written are testable without a
 * database; the write itself is not, because it replaces the live snapshot and
 * the tests run against the production project.
 */

function rand(codSaga: string, gestiune: string, cantitateFinala: string): RandStoc {
  return { codSaga, gestiune, denumireGestiune: 'MATERII PRIME', denumire: '', um: 'BUC', cantitateFinala }
}

describe('separarea codurilor necunoscute', () => {
  const cunoscute = new Set(['00000018', '00003469'])

  it('păstrează articolele din nomenclator', () => {
    const { pastrate } = separaNecunoscute([rand('00000018', '0001', '5')], cunoscute)
    expect(pastrate).toHaveLength(1)
  })

  it('sare peste un cod pe care nomenclatorul nu-l are, fără să-l creeze', () => {
    const { pastrate, necunoscute } = separaNecunoscute(
      [rand('00000018', '0001', '5'), rand('00099999', '0001', '2')],
      cunoscute,
    )
    expect(pastrate).toHaveLength(1)
    expect(necunoscute).toEqual(['00099999'])
  })

  it('numără un cod necunoscut o singură dată, oricâte gestiuni ar avea', () => {
    const { necunoscute } = separaNecunoscute(
      [rand('00099999', '0001', '2'), rand('00099999', '0010', '3')],
      cunoscute,
    )
    expect(necunoscute).toEqual(['00099999'])
  })

  it('ignoră un rând fără cod', () => {
    const { pastrate, necunoscute } = separaNecunoscute([rand('', '0001', '5')], cunoscute)
    expect(pastrate).toEqual([])
    expect(necunoscute).toEqual([])
  })
})

describe('deduplicarea pe articol și gestiune', () => {
  it('păstrează același articol în gestiuni diferite', () => {
    // The primary key is the pair, so these are two legitimate rows.
    expect(deduplicheaza([rand('00000018', '0001', '5'), rand('00000018', '0010', '7')])).toHaveLength(2)
  })

  it('reduce o pereche repetată la ultima valoare', () => {
    // A duplicated pair would abort the whole write on a conflict. Losing one
    // reading beats losing the snapshot.
    const iesire = deduplicheaza([rand('00000018', '0001', '5'), rand('00000018', '0001', '9')])
    expect(iesire).toHaveLength(1)
    expect(iesire[0]?.cantitateFinala).toBe('9')
  })

  it('nu atinge cantitățile, nici măcar pe cele negative', () => {
    const iesire = deduplicheaza([rand('00008747', '0001', '-4.125')])
    expect(iesire[0]?.cantitateFinala).toBe('-4.125')
  })
})
