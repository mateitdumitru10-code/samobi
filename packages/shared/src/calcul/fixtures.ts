import type { DimensiuneCeruta, Dimensiune, IntervalDimensiuni, LinieReteta, Reteta } from './tipuri.js'

/** Test helpers. Kept out of the public entry point on purpose. */

export const DIM_2000x1600: Dimensiune = {
  id: 'dim-1',
  cod: '2000x1600',
  lungime: '2000',
  latime: '1600',
  inaltime: '350',
}

export const DIM_FARA_INALTIME: Dimensiune = {
  id: 'dim-2',
  cod: '1900x1400',
  lungime: '1900',
  latime: '1400',
  inaltime: null,
}

let contor = 0

export function linie(partial: Partial<LinieReteta> = {}): LinieReteta {
  contor += 1
  return {
    id: `linie-${contor}`,
    nrLinie: contor,
    grup: 'STRUCTURA',
    codSaga: '00016024',
    esteVariabil: false,
    categorieVariabila: null,
    um: 'MC',
    modCalcul: 'fixa',
    cantitateFixa: '1',
    formula: null,
    procentPierderi: '0',
    gestiuneDescarcare: null,
    valoriPeDimensiuni: [],
    ...partial,
  }
}

export function reteta(linii: readonly LinieReteta[]): Reteta {
  return { id: 'reteta-1', modelId: 'model-1', versiune: 1, linii }
}

/** A size nobody registered: no id, so no table values and no overrides. */
export const DIM_LA_COMANDA: DimensiuneCeruta = {
  id: null,
  cod: '2150×1450×400',
  lungime: '2150',
  latime: '1450',
  inaltime: '400',
}

export const INTERVAL: IntervalDimensiuni = {
  lungimeMin: '1800',
  lungimeMax: '2200',
  latimeMin: '800',
  latimeMax: '2000',
  inaltimeMin: '300',
  inaltimeMax: '450',
}
