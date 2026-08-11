import { D, catreString, type Dec } from './decimal.js'
import {
  EroareCantitateFixaLipsa,
  EroareCantitateManualaNepermisa,
  EroareCantitateNegativa,
  EroareCodSagaLipsa,
  EroareFormulaLipsa,
  EroareGestiuneInconsistenta,
  EroareInaltimeLipsa,
  EroareMaterialNerezolvat,
  EroareNumarInvalid,
  EroareRezultatNenumeric,
  EroareUmInconsistenta,
  EroareValoareLipsaPeDimensiune,
} from './erori.js'
import { evalueazaFormula, valideazaFormula, type ScopFormula } from './formula.js'
import type {
  ConsumLine,
  Contributie,
  DimensiuneCeruta,
  Reteta,
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
      // Missing is an error, never zero: a bon with a silent zero on the
      // upholstery line is a bon that gets produced with no fabric booked.
      // A dimension added today starts without table values, and filling them
      // in is the point of the per-dimension columns in the recipe grid.
      if (valoare === undefined) {
        throw new EroareValoareLipsaPeDimensiune(linie.nrLinie, dimensiune.cod)
      }
      return {
        neta: parseNumar(valoare.cantitate, 'cantitate', linie.nrLinie),
        sursa: 'tabel',
        formulaEvaluata: null,
        formula: null,
      }
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
): CantitateLinie[] {
  return reteta.linii.map((linie) => {
    try {
      const { neta, sursa } = cantitateNetaUnitara(linie, dimensiune)
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

  const cantitateProdus = parseNumar(intrare.cantitateProdus, 'cantitate produs')
  if (cantitateProdus.lessThanOrEqualTo(0)) {
    throw new EroareNumarInvalid('cantitate produs', intrare.cantitateProdus)
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

  const manuale = intrare.cantitatiManuale ?? new Map<string, string>()
  for (const [linieId] of manuale) {
    const linie = reteta.linii.find((l) => l.id === linieId)
    if (linie !== undefined && !linie.esteVariabil) {
      throw new EroareCantitateManualaNepermisa(linie.nrLinie)
    }
  }

  for (const linie of reteta.linii) {
    const {
      neta: netaDinReteta,
      sursa: sursaReteta,
      formulaEvaluata,
      formula,
    } = cantitateNetaUnitara(linie, dimensiune)

    // What the recipe says is a suggestion on a variable line: the metreage
    // was measured on whatever fabric that run used, and the next one is a
    // different width. The typed figure wins, and says so in `sursa`.
    const manuala = manuale.get(linie.id)
    const areManuala = manuala !== undefined && manuala.trim() !== ''
    const netaUnitara = areManuala
      ? parseNumar(manuala, 'cantitate manuală', linie.nrLinie)
      : netaDinReteta
    const sursa: SursaCantitate = areManuala ? 'manual' : sursaReteta

    if (areManuala && netaUnitara.lessThanOrEqualTo(0)) {
      throw new EroareNumarInvalid('cantitate manuală', manuala, linie.nrLinie)
    }

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
