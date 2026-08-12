import { describe, expect, it } from 'vitest'

import { citesteSituatie } from './xml.js'

/**
 * The fixture is cut from a real 22 MB response, not invented: the lying
 * `utf-16` declaration, the self-closing empty tags and `SARMA 3&amp;4` are all
 * things SAGA actually sent.
 */
const RASPUNS = `<?xml version="1.0" encoding="utf-16"?>
<Situatie>
  <LinieSituatieXML>
    <GESTIUNE>0001</GESTIUNE>
    <DEN_GEST>MATERII PRIME</DEN_GEST>
    <DENUMIRE>CANT PAL</DENUMIRE>
    <COD_ART>00000018</COD_ART>
    <GRUPA />
    <UM>ML</UM>
    <CANT_FIN>0</CANT_FIN>
    <TEXT_SUPL />
  </LinieSituatieXML>
  <LinieSituatieXML>
    <GESTIUNE>0008</GESTIUNE>
    <DEN_GEST>IMOBILIZARI IN CURS</DEN_GEST>
    <DENUMIRE>SARMA 3&amp;4</DENUMIRE>
    <COD_ART>00003469</COD_ART>
    <UM>KG</UM>
    <CANT_FIN>62</CANT_FIN>
  </LinieSituatieXML>
  <LinieSituatieXML>
    <GESTIUNE>0001</GESTIUNE>
    <DEN_GEST>MATERII PRIME</DEN_GEST>
    <DENUMIRE>POLIURETAN 2538</DENUMIRE>
    <COD_ART>00008747</COD_ART>
    <UM>BUC</UM>
    <CANT_FIN>-4.125</CANT_FIN>
  </LinieSituatieXML>
</Situatie>`

describe('citirea situației de stocuri', () => {
  it('citește fiecare linie', () => {
    expect(citesteSituatie(RASPUNS)).toHaveLength(3)
  })

  it('nu se împiedică de declarația care minte despre codificare', () => {
    // The document says utf-16, the bytes are utf-8. Diacritics have to survive.
    const cu = RASPUNS.replace('CANT PAL', 'CANT PAL ȘTANȚAT')
    expect(citesteSituatie(cu)[0]?.['DENUMIRE']).toBe('CANT PAL ȘTANȚAT')
  })

  it('tratează tagurile auto-închise ca valoare goală, nu ca lipsă', () => {
    const [primul] = citesteSituatie(RASPUNS)
    expect(primul?.['GRUPA']).toBe('')
    expect(primul?.['TEXT_SUPL']).toBe('')
  })

  it('decodează entitățile din denumiri', () => {
    expect(citesteSituatie(RASPUNS)[1]?.['DENUMIRE']).toBe('SARMA 3&4')
  })

  it('nu confundă containerul cu un câmp', () => {
    const chei = Object.keys(citesteSituatie(RASPUNS)[0] ?? {})
    expect(chei).not.toContain('Situatie')
    expect(chei).not.toContain('LinieSituatieXML')
  })

  it('păstrează cantitățile ca text, cu semn și zecimale', () => {
    // Parsed as a number this becomes -4.125 and then, six decimals later,
    // something that no longer matches the accountant's figure.
    expect(citesteSituatie(RASPUNS)[2]?.['CANT_FIN']).toBe('-4.125')
  })

  it('păstrează zerourile din fața codului', () => {
    expect(citesteSituatie(RASPUNS)[0]?.['COD_ART']).toBe('00000018')
  })

  it('întoarce o listă goală pentru un răspuns fără linii', () => {
    expect(citesteSituatie('<?xml version="1.0"?><Situatie />')).toEqual([])
  })

  it('citește un câmp adăugat de SAGA fără schimbări aici', () => {
    const cu = RASPUNS.replace('<UM>KG</UM>', '<UM>KG</UM><LOT>A-17</LOT>')
    expect(citesteSituatie(cu)[1]?.['LOT']).toBe('A-17')
  })
})
