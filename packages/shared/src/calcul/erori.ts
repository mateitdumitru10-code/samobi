/**
 * Business errors are typed classes, not thrown strings (CLAUDE.md).
 * `mesaj` is user-facing Romanian; `cod` is what the API maps to a response.
 */
export abstract class EroareCalcul extends Error {
  abstract readonly cod: string

  constructor(
    mesaj: string,
    readonly context: Readonly<Record<string, string | number | null>> = {},
  ) {
    super(mesaj)
    this.name = new.target.name
  }
}

export class EroareFormulaInvalida extends EroareCalcul {
  readonly cod = 'FORMULA_INVALIDA'

  constructor(formula: string, detaliu: string, nrLinie?: number) {
    super(`Formula „${formula}" nu poate fi interpretată: ${detaliu}`, {
      formula,
      detaliu,
      nrLinie: nrLinie ?? null,
    })
  }
}

export class EroareVariabilaNecunoscuta extends EroareCalcul {
  readonly cod = 'VARIABILA_NECUNOSCUTA'

  constructor(formula: string, variabile: readonly string[], nrLinie?: number) {
    super(
      `Formula „${formula}" folosește variabile nepermise: ${variabile.join(', ')}. ` +
        `Sunt permise doar L, l și H.`,
      { formula, variabile: variabile.join(','), nrLinie: nrLinie ?? null },
    )
  }
}

export class EroareRezultatNenumeric extends EroareCalcul {
  readonly cod = 'REZULTAT_NENUMERIC'

  constructor(formula: string, expresieEvaluata: string, nrLinie: number) {
    super(
      `Formula de pe linia ${nrLinie} nu produce un număr valid. ` +
        `Evaluat: ${expresieEvaluata}. Verifică împărțirile la zero.`,
      { formula, expresieEvaluata, nrLinie },
    )
  }
}

export class EroareInaltimeLipsa extends EroareCalcul {
  readonly cod = 'INALTIME_LIPSA'

  constructor(codDimensiune: string, nrLinie: number) {
    super(
      `Linia ${nrLinie} folosește H, dar dimensiunea „${codDimensiune}" nu are înălțime definită.`,
      { codDimensiune, nrLinie },
    )
  }
}

/** `mod_calcul = 'tabel'` without a row for this dimension is an error, never zero. */
export class EroareValoareLipsaPeDimensiune extends EroareCalcul {
  readonly cod = 'VALOARE_LIPSA_PE_DIMENSIUNE'

  constructor(nrLinie: number, codDimensiune: string) {
    super(
      `Linia ${nrLinie} este pe mod „tabel", dar nu are cantitate definită pentru ` +
        `dimensiunea „${codDimensiune}".`,
      { nrLinie, codDimensiune },
    )
  }
}

/**
 * A `tabel` line at a size nobody registered.
 *
 * The mode exists because the value does not follow from geometry — it is a
 * cutting layout somebody decided. So at an unregistered size there is nothing
 * to look up and nothing honest to interpolate: the engine asks for the number
 * and records who gave it.
 */
export class EroareValoareManualaLipsa extends EroareCalcul {
  readonly cod = 'VALOARE_MANUALA_LIPSA'

  constructor(
    readonly linii: readonly { nrLinie: number; grup: string; um: string }[],
  ) {
    super(
      `Liniile ${linii.map((l) => l.nrLinie).join(', ')} sunt pe mod „tabel" și nu au ` +
        `valoare pentru o dimensiune la comandă. Cantitățile trebuie introduse la bon.`,
      { nrLinii: linii.map((l) => l.nrLinie).join(',') },
    )
  }
}

/** `numeric(18,6)` reads back as '1800.000000'; nobody says that out loud. */
function mm(valoare: string): string {
  const n = Number(valoare)
  return Number.isFinite(n) ? String(n) : valoare
}

export class EroareDimensiuneInAfaraIntervalului extends EroareCalcul {
  readonly cod = 'DIMENSIUNE_IN_AFARA_INTERVALULUI'

  constructor(axa: 'lungime' | 'lățime' | 'înălțime', valoare: string, min: string, max: string) {
    super(
      `${axa[0]?.toUpperCase()}${axa.slice(1)} de ${mm(valoare)} mm este în afara intervalului ` +
        `acceptat de model: ${mm(min)}–${mm(max)} mm.`,
      { axa, valoare: mm(valoare), min: mm(min), max: mm(max) },
    )
  }
}

/** The model has not been opened to made-to-order sizes at all. */
export class EroareDimensiuneLaComandaNepermisa extends EroareCalcul {
  readonly cod = 'DIMENSIUNE_LA_COMANDA_NEPERMISA'

  constructor() {
    super(
      'Modelul nu acceptă dimensiuni la comandă. Tehnologul stabilește intervalul la ' +
        '„Modele și rețete".',
    )
  }
}

export class EroareCantitateFixaLipsa extends EroareCalcul {
  readonly cod = 'CANTITATE_FIXA_LIPSA'

  constructor(nrLinie: number) {
    super(`Linia ${nrLinie} este pe mod „fixa", dar nu are cantitate completată.`, { nrLinie })
  }
}

export class EroareFormulaLipsa extends EroareCalcul {
  readonly cod = 'FORMULA_LIPSA'

  constructor(nrLinie: number) {
    super(`Linia ${nrLinie} este pe mod „formula", dar nu are formulă completată.`, { nrLinie })
  }
}

export class EroareMaterialNerezolvat extends EroareCalcul {
  readonly cod = 'MATERIAL_NEREZOLVAT'

  constructor(nrLinie: number, categorie: string | null) {
    super(
      `Linia ${nrLinie} este variabilă${categorie ? ` (${categorie})` : ''} și nu are ` +
        `material ales.`,
      { nrLinie, categorie },
    )
  }
}

export class EroareCodSagaLipsa extends EroareCalcul {
  readonly cod = 'COD_SAGA_LIPSA'

  constructor(nrLinie: number) {
    super(`Linia ${nrLinie} nu este variabilă și nu are cod SAGA.`, { nrLinie })
  }
}

/** Two lines carrying the same article must agree on its unit of measure. */
export class EroareUmInconsistenta extends EroareCalcul {
  readonly cod = 'UM_INCONSISTENTA'

  constructor(codSaga: string, um: string, umConflict: string) {
    super(
      `Articolul ${codSaga} apare cu unități de măsură diferite în aceeași rețetă: ` +
        `${um} și ${umConflict}.`,
      { codSaga, um, umConflict },
    )
  }
}

export class EroareGestiuneInconsistenta extends EroareCalcul {
  readonly cod = 'GESTIUNE_INCONSISTENTA'

  constructor(codSaga: string, gestiune: string | null, gestiuneConflict: string | null) {
    super(
      `Articolul ${codSaga} se descarcă din gestiuni diferite în aceeași rețetă: ` +
        `${gestiune ?? '(implicită)'} și ${gestiuneConflict ?? '(implicită)'}.`,
      { codSaga, gestiune, gestiuneConflict },
    )
  }
}

export class EroareNumarInvalid extends EroareCalcul {
  readonly cod = 'NUMAR_INVALID'

  constructor(camp: string, valoare: string, nrLinie?: number) {
    super(`Valoarea „${valoare}" din câmpul ${camp} nu este un număr valid.`, {
      camp,
      valoare,
      nrLinie: nrLinie ?? null,
    })
  }
}

export class EroareCantitateNegativa extends EroareCalcul {
  readonly cod = 'CANTITATE_NEGATIVA'

  constructor(nrLinie: number, valoare: string) {
    super(`Linia ${nrLinie} produce o cantitate negativă: ${valoare}.`, { nrLinie, valoare })
  }
}
