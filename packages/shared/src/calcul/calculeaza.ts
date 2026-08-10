import { D, catreString, type Dec } from './decimal.js'
import {
  EroareCantitateFixaLipsa,
  EroareCantitateNegativa,
  EroareCodSagaLipsa,
  EroareDimensiuneInAfaraIntervalului,
  EroareDimensiuneLaComandaNepermisa,
  EroareFormulaLipsa,
  EroareGestiuneInconsistenta,
  EroareInaltimeLipsa,
  EroareMaterialNerezolvat,
  EroareNumarInvalid,
  EroareRezultatNenumeric,
  EroareUmInconsistenta,
  EroareValoareLipsaPeDimensiune,
  EroareValoareManualaLipsa,
} from './erori.js'
import { evalueazaFormula, valideazaFormula, type ScopFormula } from './formula.js'
import type {
  ConsumLine,
  Contributie,
  DimensiuneCeruta,
  Reteta,
  IntervalDimensiuni,
  IntrareCalcul,
  LinieReteta,
  RezultatCalcul,
  SursaCantitate,
  ValoarePeDimensiune,
} from './tipuri.js'

/** Decimals kept in the exported XLSX (SPEC.md §6). */
export const ZECIMALE_EXPORT = 3

function parseNumar(valoare: string, camp: string, nrLinie?: number): Dec {
  const d = new D(valoare)
  if (!d.isFinite()) throw new EroareNumarInvalid(camp, valoare, nrLinie)
  return d
}

function construiesteScop(dimensiune: DimensiuneCeruta): ScopFormula {
  return {
    L: parseNumar(dimensiune.lungime, 'lungime').toNumber(),
    l: parseNumar(dimensiune.latime, 'latime').toNumber(),
    H: dimensiune.inaltime === null ? null : parseNumar(dimensiune.inaltime, 'inaltime').toNumber(),
  }
}

function gasesteValoare(
  linie: LinieReteta,
  dimensiuneId: string | null,
): ValoarePeDimensiune | undefined {
  if (dimensiuneId === null) return undefined
  return linie.valoriPeDimensiuni.find((v) => v.dimensiuneId === dimensiuneId)
}

/**
 * Refuses a made-to-order size the model was never opened to.
 *
 * Blocking rather than warning, on purpose: a warning band is a band people
 * click through, and what is on the other side of it is a bon with the wrong
 * quantity of the most expensive material in the product.
 */
function verificaInterval(
  dimensiune: DimensiuneCeruta,
  interval: IntervalDimensiuni | null | undefined,
): void {
  if (dimensiune.id !== null) return
  if (interval === null || interval === undefined) throw new EroareDimensiuneLaComandaNepermisa()

  const axe: [string | null, 'lungime' | 'lățime' | 'înălțime', string | null, string | null][] = [
    [dimensiune.lungime, 'lungime', interval.lungimeMin, interval.lungimeMax],
    [dimensiune.latime, 'lățime', interval.latimeMin, interval.latimeMax],
    [dimensiune.inaltime, 'înălțime', interval.inaltimeMin, interval.inaltimeMax],
  ]

  for (const [valoare, axa, min, max] of axe) {
    // An axis the model does not use, or a size that does not state it: the
    // formulas decide whether that is a problem, not this check.
    if (valoare === null || min === null || max === null) continue
    const v = parseNumar(valoare, axa)
    if (v.lessThan(new D(min)) || v.greaterThan(new D(max))) {
      throw new EroareDimensiuneInAfaraIntervalului(axa, catreString(v), min, max)
    }
  }
}

interface CantitateUnitara {
  neta: Dec
  sursa: SursaCantitate
  formulaEvaluata: string | null
  formula: string | null
}

/**
 * The net quantity for one product, before waste.
 *
 * A manual override wins over everything, including a formula — that is the
 * whole point of an override, and the tehnolog who set it knows something the
 * formula does not.
 */
function cantitateNetaUnitara(
  linie: LinieReteta,
  dimensiune: DimensiuneCeruta,
  valoriManuale: ReadonlyMap<string, string>,
): CantitateUnitara {
  const valoare = gasesteValoare(linie, dimensiune.id)

  if (valoare?.esteOverride === true) {
    return {
      neta: parseNumar(valoare.cantitate, 'cantitate override', linie.nrLinie),
      sursa: 'override',
      formulaEvaluata: null,
      formula: null,
    }
  }

  switch (linie.modCalcul) {
    case 'fixa': {
      if (linie.cantitateFixa === null) throw new EroareCantitateFixaLipsa(linie.nrLinie)
      return {
        neta: parseNumar(linie.cantitateFixa, 'cantitate_fixa', linie.nrLinie),
        sursa: 'fixa',
        formulaEvaluata: null,
        formula: null,
      }
    }

    case 'tabel': {
      if (valoare !== undefined) {
        return {
          neta: parseNumar(valoare.cantitate, 'cantitate', linie.nrLinie),
          sursa: 'tabel',
          formulaEvaluata: null,
          formula: null,
        }
      }

      // At a made-to-order size the table has nothing to say, by construction.
      // The value comes from the person issuing the bon, and is recorded as
      // theirs — the one thing that must not happen here is a guess.
      const manuala = valoriManuale.get(linie.id)
      if (dimensiune.id === null && manuala !== undefined && manuala.trim() !== '') {
        return {
          neta: parseNumar(manuala, 'cantitate manuală', linie.nrLinie),
          sursa: 'manual',
          formulaEvaluata: null,
          formula: null,
        }
      }

      // Missing is an error, never zero: a bon with a silent zero on the
      // upholstery line is a bon that gets produced with no fabric booked.
      throw new EroareValoareLipsaPeDimensiune(linie.nrLinie, dimensiune.cod)
    }

    case 'formula': {
      if (linie.formula === null || linie.formula.trim() === '') {
        throw new EroareFormulaLipsa(linie.nrLinie)
      }
      const validata = valideazaFormula(linie.formula, linie.nrLinie)
      if (validata.foloseteInaltime && dimensiune.inaltime === null) {
        throw new EroareInaltimeLipsa(dimensiune.cod, linie.nrLinie)
      }

      const rezultat = evalueazaFormula(linie.formula, construiesteScop(dimensiune))
      if (!rezultat.esteNumar) {
        throw new EroareRezultatNenumeric(linie.formula, rezultat.expresieEvaluata, linie.nrLinie)
      }
      return {
        neta: rezultat.valoare,
        sursa: 'formula',
        formulaEvaluata: rezultat.expresieEvaluata,
        formula: linie.formula,
      }
    }
  }
}

function rezolvaCodSaga(linie: LinieReteta, alegeri: ReadonlyMap<string, string>): string {
  if (!linie.esteVariabil) {
    if (linie.codSaga === null) throw new EroareCodSagaLipsa(linie.nrLinie)
    return linie.codSaga
  }

  const ales = alegeri.get(linie.id)
  if (ales === undefined || ales.trim() === '') {
    throw new EroareMaterialNerezolvat(linie.nrLinie, linie.categorieVariabila)
  }
  return ales
}

export interface CantitateLinie {
  linieId: string
  nrLinie: number
  /** null when the line cannot be computed at this size; `motiv` says why */
  cantitate: string | null
  sursa: SursaCantitate | null
  motiv: string | null
}

/**
 * What each line contributes at one size, line by line and failure by failure.
 *
 * Deliberately not the bon calculation: it resolves no articles, aggregates
 * nothing, and one line that cannot be computed does not stop the others. That
 * is what makes it usable for the question the tehnolog actually asks — *how do
 * the quantities move when the size changes* — where a recipe half-finished, or
 * one whose fabric comes from a table, still has plenty to show.
 */
export function cantitatiPeLinie(
  reteta: Reteta,
  dimensiune: DimensiuneCeruta,
  valoriManuale: ReadonlyMap<string, string> = new Map(),
): CantitateLinie[] {
  return reteta.linii.map((linie) => {
    try {
      const { neta, sursa } = cantitateNetaUnitara(linie, dimensiune, valoriManuale)
      return {
        linieId: linie.id,
        nrLinie: linie.nrLinie,
        cantitate: catreString(neta),
        sursa,
        motiv: null,
      }
    } catch (err) {
      return {
        linieId: linie.id,
        nrLinie: linie.nrLinie,
        cantitate: null,
        sursa: null,
        motiv: err instanceof Error ? err.message : 'nu se poate calcula',
      }
    }
  })
}

/**
 * Turns a recipe plus a dimension into the consumption rows of a bon.
 *
 * Pure: no database, no clock, no I/O. Everything it needs arrives as an
 * argument, which is what makes it testable and what makes a bon from July
 * reproducible in August.
 */
export function calculeazaConsumuri(intrare: IntrareCalcul): RezultatCalcul {
  const { reteta, dimensiune, alegeriMateriale } = intrare
  const valoriManuale = intrare.valoriManuale ?? new Map<string, string>()

  verificaInterval(dimensiune, intrare.interval)

  const cantitateProdus = parseNumar(intrare.cantitateProdus, 'cantitate produs')
  if (cantitateProdus.lessThanOrEqualTo(0)) {
    throw new EroareNumarInvalid('cantitate produs', intrare.cantitateProdus)
  }

  // Every missing table value at once, not the first one. Being sent back for
  // the next number after typing the previous one is how a form loses a person.
  if (dimensiune.id === null) {
    const lipsa = reteta.linii
      .filter(
        (l) =>
          l.modCalcul === 'tabel' &&
          (valoriManuale.get(l.id) ?? '').trim() === '' &&
          gasesteValoare(l, dimensiune.id) === undefined,
      )
      .map((l) => ({ nrLinie: l.nrLinie, grup: l.grup, um: l.um }))
    if (lipsa.length > 0) throw new EroareValoareManualaLipsa(lipsa)
  }

  const acumulator = new Map<
    string,
    {
      um: string
      gestiuneDescarcare: string | null
      neta: Dec
      bruta: Dec
      contributii: Contributie[]
    }
  >()

  for (const linie of reteta.linii) {
    const {
      neta: netaUnitara,
      sursa,
      formulaEvaluata,
      formula,
    } = cantitateNetaUnitara(linie, dimensiune, valoriManuale)

    const procent = parseNumar(linie.procentPierderi, 'procent_pierderi', linie.nrLinie)
    const factorPierderi = new D(1).plus(procent.dividedBy(100))

    const neta = netaUnitara.times(cantitateProdus)
    const bruta = neta.times(factorPierderi)

    if (neta.isNegative()) {
      throw new EroareCantitateNegativa(linie.nrLinie, catreString(neta))
    }

    const codSaga = rezolvaCodSaga(linie, alegeriMateriale)

    const contributie: Contributie = {
      linieId: linie.id,
      nrLinie: linie.nrLinie,
      grup: linie.grup,
      sursa,
      formulaEvaluata,
      formula,
      procentPierderi: catreString(procent),
      cantitateNeta: catreString(neta),
      cantitateBruta: catreString(bruta),
    }

    const existent = acumulator.get(codSaga)
    if (existent === undefined) {
      acumulator.set(codSaga, {
        um: linie.um,
        gestiuneDescarcare: linie.gestiuneDescarcare,
        neta,
        bruta,
        contributii: [contributie],
      })
      continue
    }

    // Same article on two lines is normal — the same fabric on the seat and on
    // the back. Disagreeing on its unit or its warehouse is not.
    if (existent.um !== linie.um) {
      throw new EroareUmInconsistenta(codSaga, existent.um, linie.um)
    }
    if (existent.gestiuneDescarcare !== linie.gestiuneDescarcare) {
      throw new EroareGestiuneInconsistenta(
        codSaga,
        existent.gestiuneDescarcare,
        linie.gestiuneDescarcare,
      )
    }

    existent.neta = existent.neta.plus(neta)
    existent.bruta = existent.bruta.plus(bruta)
    existent.contributii.push(contributie)
  }

  const linii: ConsumLine[] = []
  for (const [codSaga, agregat] of acumulator) {
    const surse = new Set(agregat.contributii.map((c) => c.sursa))
    const sursa: ConsumLine['sursa'] =
      surse.size === 1 ? (agregat.contributii[0]?.sursa ?? 'manual') : 'agregat'

    linii.push({
      codSaga,
      um: agregat.um,
      gestiuneDescarcare: agregat.gestiuneDescarcare,
      cantitateNeta: catreString(agregat.neta),
      cantitateBruta: catreString(agregat.bruta),
      // Rounding happens once, here, at the very end. Rounding each line as it
      // is computed makes the total drift.
      cantitateBrutaRotunjita: agregat.bruta.toFixed(ZECIMALE_EXPORT),
      sursa,
      contributii: agregat.contributii,
    })
  }

  return {
    retetaId: reteta.id,
    versiuneReteta: reteta.versiune,
    dimensiuneId: dimensiune.id,
    dimensiune,
    cantitateProdus: catreString(cantitateProdus),
    linii,
  }
}
