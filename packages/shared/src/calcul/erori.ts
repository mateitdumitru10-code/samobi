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
