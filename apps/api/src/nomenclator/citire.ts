import type { TipArticol } from '@samobi/shared/db'
import { determinaTip, normalizeazaCodSaga, normalizeazaUm } from '@samobi/shared/nomenclator'

import { CerereInvalida } from '../erori.js'

import { citesteXlsx } from './xlsx.js'

/**
 * Reads the SAGA export.
 *
 * The file people actually have is a stock report: one row per article *and*
 * warehouse, so a single article appears up to a dozen times. It carries more
 * than a catalogue would — accounts, average prices, stock on hand — and those
 * extra columns are what let us classify articles properly.
 *
 * Column names are matched by alias, because SAGA's export screens do not agree
 * with each other on what to call things.
 */

const ALIASURI: Readonly<Record<string, readonly string[]>> = {
  cod: ['cod_art', 'cod', 'cod_saga', 'codart'],
  denumire: ['denumire', 'den_art', 'denumire_art', 'nume'],
  um: ['um', 'unitate', 'u_m'],
  tipSaga: ['den_tip', 'tip', 'tip_art'],
  gestiune: ['den_gest', 'gestiune', 'gest'],
  cont: ['cont', 'cont_contabil'],
  pret: ['pret_mediu', 'pret', 'pret_ref'],
  stoc: ['cant_fin', 'stoc', 'disponibil'],
  categorie: ['grupa', 'categorie'],
}

export interface RandNomenclator {
  cod: string
  denumire: string
  um: string
  umNormalizat: string | null
  tip: TipArticol
  tipSaga: string | null
  cont: string | null
  gestiune: string | null
  categorie: string | null
  pret: string | null
  stoc: number
}

function normalizeazaAntet(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function numar(text: string): number {
  const curat = text.replace(/\s/g, '').replace(',', '.')
  const n = Number(curat)
  return Number.isFinite(n) ? n : 0
}

export function citesteNomenclator(continut: Buffer): RandNomenclator[] {
  let foaie
  try {
    foaie = citesteXlsx(continut)
  } catch (err) {
    throw new CerereInvalida(`Fișierul nu a putut fi citit: ${(err as Error).message}`)
  }

  // The header is not always the first row: exports sometimes carry a title.
  let indexAntet = -1
  let coloane: Record<string, number> = {}

  for (let i = 0; i < Math.min(foaie.randuri.length, 20); i += 1) {
    const gasite: Record<string, number> = {}
    const rand = foaie.randuri[i] ?? []
    rand.forEach((celula, index) => {
      const antet = normalizeazaAntet(celula)
      for (const [camp, aliasuri] of Object.entries(ALIASURI)) {
        if (aliasuri.includes(antet) && gasite[camp] === undefined) gasite[camp] = index
      }
    })
    if (gasite['cod'] !== undefined && gasite['denumire'] !== undefined) {
      indexAntet = i
      coloane = gasite
      break
    }
  }

  if (indexAntet < 0) {
    throw new CerereInvalida(
      'Nu am găsit antetul. Fișierul trebuie să aibă o coloană de cod (cod_art) și una de denumire.',
    )
  }

  const randuri: RandNomenclator[] = []

  for (let i = indexAntet + 1; i < foaie.randuri.length; i += 1) {
    const rand = foaie.randuri[i] ?? []
    const ia = (camp: string): string => {
      const index = coloane[camp]
      return index === undefined ? '' : (rand[index] ?? '').trim()
    }

    const cod = normalizeazaCodSaga(ia('cod'))
    const denumire = ia('denumire')
    if (cod === null || denumire === '') continue

    const umBrut = ia('um')
    const cont = ia('cont')
    const tipSaga = ia('tipSaga')
    const pret = ia('pret')
    const gestiune = ia('gestiune')
    const categorie = ia('categorie')

    randuri.push({
      cod,
      denumire,
      um: umBrut,
      umNormalizat: normalizeazaUm(umBrut),
      tip: determinaTip(cont, tipSaga),
      tipSaga: tipSaga === '' ? null : tipSaga,
      cont: cont === '' ? null : cont,
      gestiune: gestiune === '' ? null : gestiune,
      categorie: categorie === '' ? null : categorie,
      pret: pret === '' ? null : pret.replace(',', '.'),
      stoc: numar(ia('stoc')),
    })
  }

  if (randuri.length === 0) {
    throw new CerereInvalida('Fișierul nu conține niciun articol.')
  }

  return randuri
}
