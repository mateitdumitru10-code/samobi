import { GRUPURI, MODURI_CALCUL } from '@samobi/shared/db'
import type { RezultatValidareFormula } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { apel, EroareApi } from '../lib/api.js'
import { coordonate, useNavigareGrila } from '../lib/grila.js'
import { CautaArticol } from '../ui/CautaArticol.js'
import { useNotificari } from '../ui/Notificari.js'
import { cant, lei } from '../ui/numere.js'
import { BannerEroare, Insigna, Schelet, mesajEroare } from '../ui/stari.js'

import { ComparatieDimensiuni } from './ComparatieDimensiuni.js'

interface Dimensiune {
  id: string
  cod: string
  lungime: string
  latime: string
  inaltime: string | null
}

interface ValoareServer {
  dimensiuneId: string
  cantitate: string
  esteOverride: boolean
  motiv: string | null
  setatDe: string | null
  setatLa: string | null
}

interface LinieServer {
  id: string
  nrLinie: number
  grup: string
  codSaga: string | null
  esteVariabil: boolean
  categorieVariabila: string | null
  um: string
  modCalcul: string
  cantitateFixa: string | null
  formula: string | null
  procentPierderi: string
  gestiuneDescarcare: string | null
  obligatoriu: boolean
  observatii: string | null
  denumireMaterial: string | null
  pretReferinta: string | null
  pretConsum: string | null
  pretConsumLa: string | null
  umSaga: string | null
  valoriPeDimensiuni: ValoareServer[]
}

interface Reteta {
  id: string
  versiune: number
  status: string
  lockVersion: number
  dimensiuni: Dimensiune[]
  linii: LinieServer[]
}

interface Valoare {
  cantitate: string
  esteOverride: boolean
  motiv: string
  setatLa: string | null
}

interface Linie {
  cheie: string
  nrLinie: number
  grup: string
  codSaga: string
  denumireMaterial: string | null
  esteVariabil: boolean
  categorieVariabila: string
  um: string
  /** SAGA's own unit for this article, kept so a mismatch can be shown. */
  umSaga: string | null
  modCalcul: string
  cantitateFixa: string
  formula: string
  procentPierderi: string
  gestiuneDescarcare: string
  observatii: string
  pret: number | null
  /** Where the price came from, so the grid does not present a guess as a fact. */
  sursaPret: 'nomenclator' | 'consum' | null
  pretLa: string | null
  valori: Record<string, Valoare>
}

let contorCheie = 0

function dinServer(linie: LinieServer): Linie {
  contorCheie += 1
  const valori: Record<string, Valoare> = {}
  for (const v of linie.valoriPeDimensiuni) {
    valori[v.dimensiuneId] = {
      cantitate: v.cantitate,
      esteOverride: v.esteOverride,
      motiv: v.motiv ?? '',
      setatLa: v.setatLa,
    }
  }
  return {
    cheie: `s${contorCheie}`,
    nrLinie: linie.nrLinie,
    grup: linie.grup,
    codSaga: linie.codSaga ?? '',
    denumireMaterial: linie.denumireMaterial,
    esteVariabil: linie.esteVariabil,
    categorieVariabila: linie.categorieVariabila ?? '',
    um: linie.um,
    umSaga: linie.umSaga,
    modCalcul: linie.modCalcul,
    cantitateFixa: linie.cantitateFixa ?? '',
    formula: linie.formula ?? '',
    procentPierderi: linie.procentPierderi,
    gestiuneDescarcare: linie.gestiuneDescarcare ?? '',
    observatii: linie.observatii ?? '',
    pret:
      linie.pretReferinta !== null
        ? Number(linie.pretReferinta)
        : linie.pretConsum !== null
          ? Number(linie.pretConsum)
          : null,
    sursaPret:
      linie.pretReferinta !== null ? 'nomenclator' : linie.pretConsum !== null ? 'consum' : null,
    pretLa: linie.pretConsumLa,
    valori,
  }
}

function linieNoua(nrLinie: number): Linie {
  contorCheie += 1
  return {
    cheie: `n${contorCheie}`,
    nrLinie,
    // Not „STRUCTURA": the group column is hidden by default, and a value
    // nobody saw would both misdescribe the material and pull the whole recipe
    // into the advanced view on the next load.
    grup: 'NECLASIFICAT',
    codSaga: '',
    denumireMaterial: null,
    esteVariabil: false,
    categorieVariabila: '',
    um: 'BUC',
    umSaga: null,
    modCalcul: 'fixa',
    cantitateFixa: '',
    formula: '',
    procentPierderi: '0',
    gestiuneDescarcare: '',
    observatii: '',
    pret: null,
    sursaPret: null,
    pretLa: null,
    valori: {},
  }
}

/** `0,5` is how a quantity is written on the paper sheets. */
function numar(text: string): number | null {
  const curat = text.trim().replace(',', '.')
  if (curat === '') return null
  const n = Number(curat)
  return Number.isFinite(n) ? n : null
}

function esteNumarInvalid(text: string): boolean {
  return text.trim() !== '' && numar(text) === null
}

/**
 * The quantity a line contributes for one product, where it can be known here.
 *
 * `fixa` and `tabel` are in the grid already. A formula depends on L, l and H,
 * and is evaluated by the server — the check panel below shows it, and the full
 * costing lives in Rapoarte → Antecalculație.
 */
function cantitatePeDimensiune(linie: Linie, dimensiuneId: string): number | null {
  const override = linie.valori[dimensiuneId]
  if (override?.esteOverride === true) return numar(override.cantitate)
  if (linie.modCalcul === 'fixa') return numar(linie.cantitateFixa)
  if (linie.modCalcul === 'tabel') return override === undefined ? null : numar(override.cantitate)
  return null
}

/** Which fields a mode actually uses. Everything else is greyed out. */
function campActiv(modCalcul: string, camp: 'cantitateFixa' | 'formula'): boolean {
  if (camp === 'cantitateFixa') return modCalcul === 'fixa'
  return modCalcul === 'formula'
}

/**
 * Which columns are on screen.
 *
 * Every one of the 3864 lines in the live data is `fixa`, at 0% waste, with no
 * per-dimension value and no override, and 96 of 98 models have a single size.
 * So six of the eleven columns were always empty, and reading a recipe meant
 * scanning past them — sideways, because eleven columns do not fit.
 *
 * The simple grid is what the data actually contains. The rest is one click
 * away and comes on by itself the moment a recipe has something to put in it,
 * so nothing is ever hidden that carries a value.
 */
const CHEIE_AVANSAT = 'samobi:reteta-avansat'

function areNevoieDeAvansat(reteta: Reteta | undefined): boolean {
  if (reteta === undefined) return false
  if (reteta.dimensiuni.length > 1) return true
  return reteta.linii.some(
    (l) =>
      l.modCalcul !== 'fixa' ||
      Number(l.procentPierderi) !== 0 ||
      l.grup !== 'NECLASIFICAT' ||
      l.valoriPeDimensiuni.length > 0,
  )
}

export function RetetaEditor({
  modelId,
  onModificat,
}: {
  modelId: string
  onModificat?: (modificat: boolean) => void
}) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const containerRef = useRef<HTMLDivElement>(null)

  const [linii, setLinii] = useState<Linie[]>([])
  const [lockVersion, setLockVersion] = useState(0)
  const [modificat, setModificat] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [serverulSASchimbat, setServerulSASchimbat] = useState(false)
  const [dimensiunePreview, setDimensiunePreview] = useState('')
  const [linieSelectata, setLinieSelectata] = useState<string | null>(null)
  const [codRau, setCodRau] = useState<Set<string>>(new Set())
  const [avansat, setAvansat] = useState(() => localStorage.getItem(CHEIE_AVANSAT) === 'true')

  const reteta = useQuery({
    queryKey: ['reteta', modelId],
    queryFn: () => apel<Reteta>(`/modele/${modelId}/reteta`),
  })

  useEffect(() => onModificat?.(modificat), [onModificat, modificat])

  /**
   * Never overwrite work in progress.
   *
   * The grid lives in component state, and this effect used to replace it with
   * whatever the server last said on every refetch — including the one that
   * fired when the tehnolog alt-tabbed to look something up in SAGA. Forty
   * transcribed lines, gone with no message.
   */
  const dateReteta = reteta.data
  // Read inside the effect but deliberately not a dependency: reacting to them
  // would re-run this — and overwrite the grid — on the first keystroke, and
  // again in the gap between a successful save and its refetch.
  const stare = useRef({ modificat, lockVersion })
  stare.current = { modificat, lockVersion }

  useEffect(() => {
    if (dateReteta === undefined) return
    if (stare.current.modificat) {
      if (dateReteta.lockVersion !== stare.current.lockVersion) setServerulSASchimbat(true)
      return
    }
    setLinii(dateReteta.linii.map(dinServer))
    setLockVersion(dateReteta.lockVersion)
    // Turned on, never off: someone who opened the extra columns keeps them.
    if (areNevoieDeAvansat(dateReteta)) setAvansat(true)
    setConflict(null)
    setServerulSASchimbat(false)
    setDimensiunePreview((curent) => (curent === '' ? (dateReteta.dimensiuni[0]?.id ?? '') : curent))
  }, [dateReteta])

  // The browser's own guard, for the tab close we cannot intercept ourselves.
  useEffect(() => {
    if (!modificat) return
    const asculta = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', asculta)
    return () => window.removeEventListener('beforeunload', asculta)
  }, [modificat])

  const dimensiuni = dateReteta?.dimensiuni ?? []

  function preiaDeLaServer() {
    if (dateReteta === undefined) return
    setModificat(false)
    setServerulSASchimbat(false)
    setConflict(null)
    void reteta.refetch()
  }

  const salveaza = useMutation({
    mutationFn: async (fortat: boolean) => {
      // Forcing is not "skip the check" — it is "I have seen that someone else
      // saved, and I still want mine". So it re-reads their version number and
      // saves against it, deliberately, instead of disabling the guard.
      const versiuneDeFolosit = fortat
        ? (await apel<Reteta>(`/modele/${modelId}/reteta`)).lockVersion
        : lockVersion

      return apel<{ lockVersion: number }>(`/retete/${dateReteta?.id ?? ''}`, {
        metoda: 'PUT',
        corp: {
          lockVersion: versiuneDeFolosit,
          linii: linii.map((linie) => ({
            nrLinie: linie.nrLinie,
            grup: linie.grup,
            codSaga: linie.esteVariabil ? null : linie.codSaga,
            esteVariabil: linie.esteVariabil,
            categorieVariabila: linie.esteVariabil ? linie.categorieVariabila : null,
            um: linie.um,
            modCalcul: linie.modCalcul,
            cantitateFixa:
              linie.modCalcul === 'fixa' ? (linie.cantitateFixa.replace(',', '.') || null) : null,
            formula: linie.modCalcul === 'formula' ? linie.formula : null,
            procentPierderi:
              linie.procentPierderi === '' ? '0' : linie.procentPierderi.replace(',', '.'),
            gestiuneDescarcare: linie.gestiuneDescarcare === '' ? null : linie.gestiuneDescarcare,
            obligatoriu: true,
            observatii: linie.observatii === '' ? null : linie.observatii,
            valoriPeDimensiuni: Object.entries(linie.valori)
              .filter(([, v]) => v.cantitate !== '')
              .map(([dimensiuneId, v]) => ({
                dimensiuneId,
                cantitate: v.cantitate.replace(',', '.'),
                esteOverride: v.esteOverride,
                motiv: v.esteOverride ? v.motiv : null,
              })),
          })),
        },
      })
    },
    onSuccess: async (rezultat) => {
      setLockVersion(rezultat.lockVersion)
      setModificat(false)
      setConflict(null)
      setServerulSASchimbat(false)
      setCodRau(new Set())
      notificari.succes('Rețeta a fost salvată.')
      await queryClient.invalidateQueries({ queryKey: ['reteta', modelId] })
    },
    onError: (err) => {
      if (err instanceof EroareApi && err.status === 409) {
        setConflict(err.message)
        return
      }
      // „Coduri care nu există în nomenclator: 00016024, 00023684" is only
      // useful if the offending cells say so themselves.
      const coduri = [...mesajEroare(err).matchAll(/\b\d{6,10}\b/g)].map((m) => m[0])
      if (coduri.length > 0) setCodRau(new Set(coduri))
      notificari.eroare(mesajEroare(err))
    },
  })

  function marcheazaModificat() {
    setModificat(true)
  }

  function schimba(cheie: string, camp: keyof Linie, valoare: string | boolean) {
    setLinii((curente) =>
      curente.map((linie) => (linie.cheie === cheie ? { ...linie, [camp]: valoare } : linie)),
    )
    marcheazaModificat()
  }

  function alegeArticol(
    cheie: string,
    articol: { codSaga: string; denumire: string; um: string },
  ) {
    setLinii((curente) =>
      curente.map((linie) =>
        linie.cheie === cheie
          ? {
              ...linie,
              codSaga: articol.codSaga,
              denumireMaterial: articol.denumire,
              umSaga: articol.um,
              um: linie.um.trim() === '' ? articol.um : linie.um,
            }
          : linie,
      ),
    )
    marcheazaModificat()
  }

  /**
   * Editing a per-dimension cell means one of two things, and the mode decides
   * which: on a `tabel` line it is the quantity, everywhere else it is an
   * override of whatever the formula or the fixed value would have produced.
   */
  function schimbaValoare(cheie: string, dimensiuneId: string, cantitate: string) {
    setLinii((curente) =>
      curente.map((linie) => {
        if (linie.cheie !== cheie) return linie
        const existenta = linie.valori[dimensiuneId]
        const valori = { ...linie.valori }
        if (cantitate === '') {
          delete valori[dimensiuneId]
        } else {
          valori[dimensiuneId] = {
            cantitate,
            esteOverride: linie.modCalcul !== 'tabel',
            motiv: existenta?.motiv ?? '',
            setatLa: existenta?.setatLa ?? null,
          }
        }
        return { ...linie, valori }
      }),
    )
    marcheazaModificat()
  }

  function schimbaMotiv(cheie: string, dimensiuneId: string, motiv: string) {
    setLinii((curente) =>
      curente.map((linie) => {
        if (linie.cheie !== cheie) return linie
        const existenta = linie.valori[dimensiuneId]
        if (existenta === undefined) return linie
        return { ...linie, valori: { ...linie.valori, [dimensiuneId]: { ...existenta, motiv } } }
      }),
    )
    marcheazaModificat()
  }

  const renumeroteaza = (lista: Linie[]) => lista.map((l, i) => ({ ...l, nrLinie: i + 1 }))

  /** Adds at the end and hands focus to it, so the keyboard never leaves the grid. */
  const adauga = useCallback(() => {
    setLinii((curente) => [...curente, linieNoua(curente.length + 1)])
    marcheazaModificat()
    requestAnimationFrame(() => {
      const celule = containerRef.current?.querySelectorAll<HTMLElement>('[data-coloana="0"]')
      celule?.[celule.length - 1]?.focus()
    })
  }, [])

  function duplica(cheie: string) {
    setLinii((curente) => {
      const index = curente.findIndex((l) => l.cheie === cheie)
      const sursa = curente[index]
      if (sursa === undefined) return curente
      contorCheie += 1
      const copie: Linie = { ...sursa, cheie: `d${contorCheie}`, valori: { ...sursa.valori } }
      return renumeroteaza([...curente.slice(0, index + 1), copie, ...curente.slice(index + 1)])
    })
    marcheazaModificat()
  }

  function muta(cheie: string, directie: -1 | 1) {
    setLinii((curente) => {
      const index = curente.findIndex((l) => l.cheie === cheie)
      const tinta = index + directie
      if (index < 0 || tinta < 0 || tinta >= curente.length) return curente
      const copie = [...curente]
      const a = copie[index]
      const b = copie[tinta]
      if (a === undefined || b === undefined) return curente
      copie[index] = b
      copie[tinta] = a
      return renumeroteaza(copie)
    })
    marcheazaModificat()
  }

  function sterge(cheie: string) {
    const stearsa = linii.find((l) => l.cheie === cheie)
    const pozitie = linii.findIndex((l) => l.cheie === cheie)
    if (stearsa === undefined) return

    setLinii((curente) => renumeroteaza(curente.filter((l) => l.cheie !== cheie)))
    marcheazaModificat()

    notificari.succes(`Linia ${stearsa.nrLinie} — ${stearsa.codSaga || 'fără cod'} ștearsă.`, {
      eticheta: 'Anulează ștergerea',
      executa: () => {
        setLinii((curente) =>
          renumeroteaza([...curente.slice(0, pozitie), stearsa, ...curente.slice(pozitie)]),
        )
        // Without this the line comes back on screen with nothing to save, and
        // the next refetch takes it away again without a word.
        marcheazaModificat()
      },
    })
  }

  const navigheazaBaza = useNavigareGrila(() => containerRef.current)

  /** Excel movement, plus what a forty-line transcription actually needs. */
  const navigheaza = (eveniment: React.KeyboardEvent<HTMLElement>) => {
    const cheie = eveniment.currentTarget.dataset['cheie']
    if (cheie !== undefined && !blocat) {
      if (eveniment.altKey && (eveniment.key === 'ArrowUp' || eveniment.key === 'ArrowDown')) {
        eveniment.preventDefault()
        muta(cheie, eveniment.key === 'ArrowUp' ? -1 : 1)
        return
      }
      if (eveniment.key === 'd' && (eveniment.ctrlKey || eveniment.metaKey)) {
        eveniment.preventDefault()
        duplica(cheie)
        return
      }
      if (eveniment.key === 'Backspace' && (eveniment.ctrlKey || eveniment.metaKey)) {
        eveniment.preventDefault()
        sterge(cheie)
        return
      }
      // Enter on the last row keeps going instead of stopping dead.
      const rand = Number(eveniment.currentTarget.dataset['rand'])
      if (eveniment.key === 'Enter' && rand === linii.length - 1) {
        eveniment.preventDefault()
        adauga()
        return
      }
    }
    navigheazaBaza(eveniment)
  }

  const overrideuri = useMemo(
    () =>
      linii.flatMap((linie) =>
        Object.entries(linie.valori)
          .filter(([, v]) => v.esteOverride)
          .map(([dimensiuneId, v]) => ({ linie, dimensiuneId, valoare: v })),
      ),
    [linii],
  )

  const overrideFaraMotiv = overrideuri.some((o) => o.valoare.motiv.trim() === '')

  /**
   * The order of the editable cells, so the arrows cross exactly what is on
   * screen. Indices are derived from this list rather than written down: a
   * hidden column with a fixed index is a hole the keyboard falls into.
   */
  // In render order, so ArrowRight goes to the cell that is visually next.
  const coloane = avansat
    ? [
        'grup',
        'material',
        'mod',
        'cantitate',
        'um',
        'formula',
        'pierderi',
        ...dimensiuni.map((d) => `dim:${d.id}`),
      ]
    : ['material', 'cantitate', 'um']
  const idx = (nume: string) => coloane.indexOf(nume)
  // Recipes have no approved state: anyone signed in edits them, always.
  const blocat = false
  const dimAleasa = dimensiuni.find((d) => d.id === dimensiunePreview)

  if (reteta.isLoading) {
    return (
      <div className="space-y-3">
        <Schelet className="h-10 w-full" />
        <Schelet className="h-64 w-full" />
      </div>
    )
  }
  if (reteta.isError) {
    return (
      <BannerEroare
        eroare={reteta.error}
        titlu="Rețeta nu s-a putut încărca."
        onReincearca={() => void reteta.refetch()}
      />
    )
  }

  return (
    <div className="space-y-4">
      {serverulSASchimbat && (
        <div className="rounded-lg border border-atentie-border bg-atentie-bg px-4 py-3 text-sm">
          <p className="font-medium text-atentie">
            Rețeta s-a schimbat pe server între timp. Ce ai scris tu e păstrat.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setServerulSASchimbat(false)}
              className="buton buton-secundar buton-mic"
            >
              Păstrez ce am scris
            </button>
            <button type="button" onClick={preiaDeLaServer} className="buton buton-pericol buton-mic">
              Reîncarcă de pe server (pierzi modificările)
            </button>
          </div>
        </div>
      )}

      {conflict !== null && (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm">
          <p className="font-medium text-danger">{conflict}</p>
          <p className="mt-1 text-ink-secondary">
            Liniile tale sunt încă pe ecran, nimic nu s-a pierdut. Alege ce se întâmplă cu ele.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={salveaza.isPending}
              onClick={() => salveaza.mutate(true)}
              className="buton buton-primar buton-mic"
            >
              Salvează peste versiunea de pe server
            </button>
            <button type="button" onClick={preiaDeLaServer} className="buton buton-pericol buton-mic">
              Preia versiunea de pe server
            </button>
          </div>
        </div>
      )}

      {dimensiuni.length === 0 && (
        <p className="rounded-lg border border-atentie-border bg-atentie-bg px-3 py-2 text-sm text-atentie">
          Modelul nu are dimensiuni. Adaugă cel puțin una înainte de rețetă — modul „tabel" și
          previzualizarea formulelor au nevoie de ele.
        </p>
      )}

      {/*
        Sticky, because a recipe is forty lines and the save button used to be
        wherever the page had been scrolled away from.
      */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-page/95 px-1 py-2 backdrop-blur">
        <span className="text-sm text-ink-secondary">
          <strong className="text-ink">{linii.length}</strong> linii
        </span>
        <TotalReteta linii={linii} dimensiuni={dimensiuni} dimensiuneId={dimensiunePreview} />
        {modificat && <Insigna fel="atentie">nesalvat</Insigna>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {avansat && dimensiuni.length > 1 && (
            <select
              value={dimensiunePreview}
              aria-label="Dimensiunea pentru care se calculează"
              onChange={(e) => setDimensiunePreview(e.target.value)}
              className="camp camp-mic w-40"
            >
              {dimensiuni.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.cod}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => {
              const nou = !avansat
              setAvansat(nou)
              localStorage.setItem(CHEIE_AVANSAT, String(nou))
            }}
            aria-pressed={avansat}
            className="buton buton-discret buton-mic"
          >
            {avansat ? 'Ascunde coloanele avansate' : 'Coloane avansate'}
          </button>
          {!blocat && (
            <>
              <button type="button" onClick={adauga} className="buton buton-secundar buton-mic">
                Adaugă linie
              </button>
              <button
                type="button"
                disabled={!modificat || salveaza.isPending}
                onClick={() => {
                  if (overrideFaraMotiv) {
                    notificari.eroare(
                      'Completează motivul pentru valorile fixate manual, în panoul de sub grilă.',
                    )
                    document
                      .getElementById('motive-override')
                      ?.scrollIntoView({ behavior: 'smooth' })
                    document.querySelector<HTMLInputElement>('[data-motiv-gol="true"]')?.focus()
                    return
                  }
                  salveaza.mutate(false)
                }}
                className="buton buton-primar buton-mic"
              >
                {salveaza.isPending ? 'Se salvează…' : 'Salvează'}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="max-h-[62vh] overflow-auto rounded-lg border border-line bg-surface"
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-sunken text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">
                #
              </th>
              {avansat && (
                <th scope="col" className="px-2 py-2 font-medium">
                  Grup
                </th>
              )}
              <th scope="col" className="px-2 py-2 font-medium">
                Material
              </th>
              {avansat && (
                <th scope="col" className="px-2 py-2 font-medium">
                  Mod
                </th>
              )}
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Cantitate
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                UM
              </th>
              {avansat && (
                <>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Formulă
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Pierderi %
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Preț (lei)
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Valoare{dimAleasa === undefined ? '' : ` · ${dimAleasa.cod}`}
                  </th>
                  {dimensiuni.map((d) => (
                    <th key={d.id} scope="col" className="px-2 py-2 font-medium">
                      {d.cod}
                    </th>
                  ))}
                </>
              )}
              <th scope="col" className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {linii.map((linie, rand) => {
              const areOverride = Object.values(linie.valori).some((v) => v.esteOverride)
              const umDiferit =
                linie.umSaga !== null &&
                linie.umSaga.trim() !== '' &&
                linie.um.trim() !== '' &&
                linie.umSaga.trim().toUpperCase() !== linie.um.trim().toUpperCase()
              const codInexistent = codRau.has(linie.codSaga)
              const ancora = { 'data-cheie': linie.cheie }

              return (
                <tr
                  key={linie.cheie}
                  onFocus={() => setLinieSelectata(linie.cheie)}
                  className={
                    linieSelectata === linie.cheie
                      ? 'border-t border-line bg-brand-subtle'
                      : 'border-t border-line odd:bg-surface-page/60'
                  }
                >
                  <td className="px-2 py-1 text-ink-disabled tabular-nums">{linie.nrLinie}</td>

                  {avansat && (
                    <td className="px-1 py-1">
                      <select
                        value={linie.grup}
                        disabled={blocat}
                        onChange={(e) => schimba(linie.cheie, 'grup', e.target.value)}
                        onKeyDown={navigheaza}
                        {...coordonate(rand, idx('grup'))}
                        {...ancora}
                        className="w-32 rounded border border-transparent px-1 py-1 hover:border-line-strong"
                      >
                        {GRUPURI.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}

                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      {linie.esteVariabil ? (
                        <input
                          value={linie.categorieVariabila}
                          disabled={blocat}
                          placeholder="TEXTIL"
                          onChange={(e) =>
                            schimba(linie.cheie, 'categorieVariabila', e.target.value)
                          }
                          onKeyDown={navigheaza}
                          {...coordonate(rand, idx('material'))}
                          {...ancora}
                          className="w-40 rounded border border-transparent px-1 py-1 font-mono text-xs hover:border-line-strong"
                        />
                      ) : blocat ? (
                        <span className="w-40 px-1 font-mono text-xs">{linie.codSaga || '—'}</span>
                      ) : (
                        <CautaArticol
                          umAsteptat={linie.um}
                          // The chosen material *is* the placeholder — the field
                          // clears after a pick — so it has to read as content
                          // rather than as an empty box.
                          clasa={`w-72 rounded border px-1 py-1 text-xs ${
                            linie.denumireMaterial === null ? '' : 'placeholder:text-ink'
                          } ${
                            codInexistent ? 'border-danger' : 'border-transparent hover:border-line-strong'
                          }`}
                          placeholder={
                            linie.denumireMaterial ?? (linie.codSaga === '' ? 'caută material…' : linie.codSaga)
                          }
                          onAlege={(a) => alegeArticol(linie.cheie, a)}
                          onTastaLibera={navigheaza}
                          {...coordonate(rand, idx('material'))}
                          {...ancora}
                        />
                      )}
                      {/*
                        This is what makes the fabric a choice. A line marked
                        here carries no article: the recipe gives the quantity
                        and whoever issues the bon says which fabric it is. All
                        201 fabric lines were marked by script; this is how a
                        new one gets marked by hand, so it stays.
                      */}
                      <button
                        type="button"
                        disabled={blocat}
                        aria-pressed={linie.esteVariabil}
                        title={
                          linie.esteVariabil
                            ? 'Materialul se alege la emiterea bonului — rețeta dă doar ' +
                              'cantitatea. Apasă ca să pui un cod fix la loc.'
                            : 'Materialul e fix, cu codul de aici. Apasă dacă se alege la ' +
                              'emiterea bonului, cum e stofa.'
                        }
                        aria-label={`Materialul de pe linia ${linie.nrLinie} se alege la emiterea bonului`}
                        onClick={() => schimba(linie.cheie, 'esteVariabil', !linie.esteVariabil)}
                        className={
                          linie.esteVariabil
                            ? 'actiune-rand shrink-0 whitespace-nowrap border border-info-border bg-info-bg px-1.5 text-[11px] font-medium text-info'
                            : 'actiune-rand shrink-0 whitespace-nowrap border border-line px-1.5 text-[11px] text-ink-disabled'
                        }
                      >
                        se alege
                      </button>
                      {/* On the row, not under it. The name is in the field and
                          the code beside it, so a line stays one line — forty
                          two-line rows is twice the grid to scroll through. */}
                      {!linie.esteVariabil && linie.codSaga !== '' && !codInexistent && (
                        <span className="font-mono text-[11px] text-ink-muted">
                          {linie.codSaga}
                        </span>
                      )}
                    </div>
                    {codInexistent && (
                      <p className="px-1 text-[11px] text-danger">
                        {linie.codSaga} nu există în nomenclator
                      </p>
                    )}
                  </td>

                  {avansat && (
                    <td className="px-1 py-1">
                      <select
                        value={linie.modCalcul}
                        disabled={blocat}
                        onChange={(e) => schimba(linie.cheie, 'modCalcul', e.target.value)}
                        onKeyDown={navigheaza}
                        {...coordonate(rand, idx('mod'))}
                        {...ancora}
                        className="w-24 rounded border border-transparent px-1 py-1 hover:border-line-strong"
                      >
                        {MODURI_CALCUL.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}

                  <td className="px-1 py-1">
                    <input
                      value={campActiv(linie.modCalcul, 'cantitateFixa') ? linie.cantitateFixa : ''}
                      disabled={blocat || !campActiv(linie.modCalcul, 'cantitateFixa')}
                      onChange={(e) => schimba(linie.cheie, 'cantitateFixa', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, idx('cantitate'))}
                      {...ancora}
                      title={
                        esteNumarInvalid(linie.cantitateFixa) ? 'Un număr, ex. 0,5' : undefined
                      }
                      className={`w-24 rounded border px-1 py-1 text-right tabular-nums disabled:bg-surface-sunken disabled:text-ink-disabled ${
                        esteNumarInvalid(linie.cantitateFixa)
                          ? 'border-danger'
                          : 'border-transparent hover:border-line-strong'
                      }`}
                    />
                  </td>

                  <td className="px-1 py-1">
                    <input
                      value={linie.um}
                      disabled={blocat}
                      onChange={(e) => schimba(linie.cheie, 'um', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, idx('um'))}
                      {...ancora}
                      title={umDiferit ? `În SAGA articolul e în ${linie.umSaga}` : undefined}
                      className={`w-16 rounded border px-1 py-1 ${
                        umDiferit
                          ? 'border-atentie-border bg-atentie-bg'
                          : 'border-transparent hover:border-line-strong'
                      }`}
                    />
                  </td>

                  {avansat && (
                    <>
                      <td className="px-1 py-1">
                        <input
                          value={campActiv(linie.modCalcul, 'formula') ? linie.formula : ''}
                          disabled={blocat || !campActiv(linie.modCalcul, 'formula')}
                          placeholder="2*(L+l)/1000"
                          onChange={(e) => schimba(linie.cheie, 'formula', e.target.value)}
                          onKeyDown={navigheaza}
                          {...coordonate(rand, idx('formula'))}
                          {...ancora}
                          className="w-52 rounded border border-transparent px-1 py-1 font-mono text-xs hover:border-line-strong disabled:bg-surface-sunken disabled:text-ink-disabled"
                        />
                      </td>

                      <td className="px-1 py-1">
                        <input
                          value={linie.procentPierderi}
                          disabled={blocat}
                          onChange={(e) => schimba(linie.cheie, 'procentPierderi', e.target.value)}
                          onKeyDown={navigheaza}
                          {...coordonate(rand, idx('pierderi'))}
                          {...ancora}
                          className={`w-16 rounded border px-1 py-1 text-right tabular-nums ${
                            esteNumarInvalid(linie.procentPierderi)
                              ? 'border-danger'
                              : 'border-transparent hover:border-line-strong'
                          }`}
                        />
                      </td>

                      <td className="px-2 py-1 text-right tabular-nums text-ink-muted">
                        {linie.pret === null ? (
                          <span className="text-xs text-atentie">fără preț</span>
                        ) : (
                          <span
                            title={
                              linie.sursaPret === 'consum'
                                ? `din ultimul consum, ${linie.pretLa ?? ''}`
                                : 'preț mediu din nomenclator'
                            }
                            className={linie.sursaPret === 'consum' ? 'text-info' : ''}
                          >
                            {lei(linie.pret)}
                          </span>
                        )}
                      </td>

                      <td className="px-2 py-1 text-right font-medium tabular-nums">
                        {(() => {
                          const cantitate = cantitatePeDimensiune(linie, dimensiunePreview)
                          if (linie.pret === null || cantitate === null) return '—'
                          const pierderi = numar(linie.procentPierderi) ?? 0
                          return lei(cantitate * (1 + pierderi / 100) * linie.pret)
                        })()}
                      </td>

                      {dimensiuni.map((d) => {
                        const valoare = linie.valori[d.id]
                        const esteOverride = valoare?.esteOverride === true
                        return (
                          <td key={d.id} className="px-1 py-1">
                            <input
                              value={valoare?.cantitate ?? ''}
                              disabled={blocat}
                              onChange={(e) => schimbaValoare(linie.cheie, d.id, e.target.value)}
                              onKeyDown={navigheaza}
                              {...coordonate(rand, idx(`dim:${d.id}`))}
                              {...ancora}
                              title={
                                linie.modCalcul === 'tabel'
                                  ? 'Cantitatea pe această dimensiune'
                                  : 'O valoare aici suprascrie calculul — are nevoie de motiv'
                              }
                              className={
                                esteOverride
                                  ? 'w-24 rounded border border-atentie-border bg-atentie-bg px-1 py-1 text-right font-medium tabular-nums text-atentie'
                                  : 'w-24 rounded border border-transparent px-1 py-1 text-right tabular-nums hover:border-line-strong'
                              }
                            />
                          </td>
                        )
                      })}
                    </>
                  )}

                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {areOverride && <Insigna fel="atentie">fixat</Insigna>}
                    {/*
                      Duplicate and move stay out of the tab order — they have
                      shortcuts, and forty rows × five stops would make Tab
                      useless. Delete does not: it had neither a stop nor a
                      shortcut, so from the keyboard a line could not be removed
                      at all. It has both now.
                    */}
                    {!blocat && (
                      <span className="ml-2 inline-flex gap-0.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-hidden
                          title="Duplică linia (Ctrl+D)"
                          onClick={() => duplica(linie.cheie)}
                          className="actiune-rand"
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-hidden
                          title="Mută în sus (Alt+↑)"
                          onClick={() => muta(linie.cheie, -1)}
                          className="actiune-rand"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-hidden
                          title="Mută în jos (Alt+↓)"
                          onClick={() => muta(linie.cheie, 1)}
                          className="actiune-rand"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          title="Șterge linia (Ctrl+Backspace)"
                          aria-label={`Șterge linia ${linie.nrLinie}`}
                          onClick={() => sterge(linie.cheie)}
                          className="actiune-rand hover:bg-danger-bg hover:text-danger"
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}

            {linii.length === 0 && (
              <tr>
                <td colSpan={coloane.length + 3} className="px-4 py-8 text-center">
                  <p className="text-sm text-ink-secondary">Rețeta nu are linii.</p>
                  {!blocat && (
                    <button type="button" onClick={adauga} className="buton buton-secundar mt-3">
                      Adaugă prima linie
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!blocat && (
        <p className="text-xs text-ink-muted">
          Săgeți între celule · Enter rândul următor (pe ultimul adaugă unul nou) · Ctrl+D duplică ·
          Alt+↑/↓ mută linia · Ctrl+Backspace șterge linia
        </p>
      )}

      {/* Below the grid live the things that are usually empty: the reasons a
          value was pinned, the formula check, the comparison across sizes. All
          three used to be open at once, which is most of the page's scroll for
          panels that say nothing on a normal recipe. */}
      {dimensiuni.length > 1 && (
        <details className="card p-0">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">
            Compară dimensiunile
          </summary>
          <div className="border-t border-line p-4">
            <ComparatieDimensiuni modelId={modelId} />
          </div>
        </details>
      )}

      {overrideuri.length > 0 && (
        <div
          id="motive-override"
          className="rounded-lg border border-atentie-border bg-atentie-bg p-4"
        >
          <h3 className="text-sm font-semibold text-atentie">
            Valori fixate manual ({overrideuri.length})
          </h3>
          <p className="mt-1 text-sm text-ink-secondary">
            Bat formula, întotdeauna. Fiecare are nevoie de un motiv — altfel nimeni nu mai știe
            peste un an de ce.
          </p>
          <ul className="mt-3 space-y-2">
            {overrideuri.map((o) => {
              const dim = dimensiuni.find((d) => d.id === o.dimensiuneId)
              const gol = o.valoare.motiv.trim() === ''
              return (
                <li
                  key={`${o.linie.cheie}-${o.dimensiuneId}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="font-medium text-ink">
                    linia {o.linie.nrLinie} · {dim?.cod} = {cant(o.valoare.cantitate)}
                  </span>
                  <input
                    value={o.valoare.motiv}
                    disabled={blocat}
                    data-motiv-gol={gol}
                    aria-invalid={gol}
                    aria-label={`Motiv pentru linia ${o.linie.nrLinie}`}
                    placeholder="motiv (obligatoriu)"
                    onChange={(e) => schimbaMotiv(o.linie.cheie, o.dimensiuneId, e.target.value)}
                    className="camp camp-mic w-72"
                  />
                  {o.valoare.setatLa !== null && (
                    <span className="text-xs text-atentie">
                      fixat la {new Date(o.valoare.setatLa).toLocaleDateString('ro-RO')}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <VerificareFormula linii={linii} dimensiuneId={dimensiunePreview} />

    </div>
  )
}

/**
 * Live check of the formulas, evaluated on the chosen dimension. The number
 * belongs on screen before the recipe is saved, not on a bon three weeks later.
 */
function VerificareFormula({ linii, dimensiuneId }: { linii: Linie[]; dimensiuneId: string }) {
  const formule = linii
    .filter((l) => l.modCalcul === 'formula' && l.formula.trim() !== '')
    .map((l) => ({ nrLinie: l.nrLinie, formula: l.formula, um: l.um }))

  if (formule.length === 0) return null

  return (
    <details className="card p-4" open>
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        Verificare formule ({formule.length})
      </summary>
      <p className="mt-1 text-xs text-ink-muted">
        Variabile: <code className="font-mono">L</code> lungime,{' '}
        <code className="font-mono">l</code> lățime, <code className="font-mono">H</code> înălțime,
        în milimetri. Operatori: <code className="font-mono">+ − * / ( )</code>.
      </p>

      <ul className="mt-3 space-y-1.5">
        {formule.map((f) => (
          <RandFormula key={f.nrLinie} {...f} dimensiuneId={dimensiuneId} />
        ))}
      </ul>
    </details>
  )
}

function RandFormula({
  nrLinie,
  formula,
  um,
  dimensiuneId,
}: {
  nrLinie: number
  formula: string
  um: string
  dimensiuneId: string
}) {
  const [amanata, setAmanata] = useState(formula)

  useEffect(() => {
    const cronometru = setTimeout(() => setAmanata(formula), 400)
    return () => clearTimeout(cronometru)
  }, [formula])

  const verificare = useQuery({
    queryKey: ['formula', amanata, dimensiuneId],
    queryFn: () =>
      apel<RezultatValidareFormula>('/retete/valideaza-formula', {
        metoda: 'POST',
        corp: { formula: amanata, ...(dimensiuneId === '' ? {} : { dimensiuneId }) },
      }),
    enabled: amanata.trim() !== '',
    retry: false,
  })

  const rezultat = verificare.data

  return (
    <li className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-ink-muted">linia {nrLinie}</span>
      <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">{formula}</code>
      {verificare.isFetching && <span className="text-xs text-ink-muted">se verifică…</span>}
      {rezultat?.valida === false && <span className="text-xs text-danger">{rezultat.mesaj}</span>}
      {rezultat?.previzualizare != null && (
        <span className="text-ink-secondary">
          = <span className="font-medium tabular-nums">{rezultat.previzualizare.valoare}</span> {um}
          <span className="ml-2 text-xs text-ink-muted">
            {rezultat.previzualizare.expresieEvaluata}
          </span>
        </span>
      )}
      {rezultat?.valida === true && rezultat.previzualizare === null && rezultat.mesaj !== null && (
        <span className="text-xs text-atentie">{rezultat.mesaj}</span>
      )}
    </li>
  )
}

/**
 * What the recipe costs for one product, as far as the catalogue allows.
 *
 * Lines with a formula and lines with no price are counted separately rather
 * than treated as zero — a total that quietly drops them reads as complete.
 */
function TotalReteta({
  linii,
  dimensiuni,
  dimensiuneId,
}: {
  linii: Linie[]
  dimensiuni: Dimensiune[]
  dimensiuneId: string
}) {
  if (linii.length === 0) return null

  let total = 0
  let faraPret = 0
  let cuFormula = 0

  for (const linie of linii) {
    if (linie.modCalcul === 'formula') {
      cuFormula += 1
      continue
    }
    const cantitate = cantitatePeDimensiune(linie, dimensiuneId)
    if (cantitate === null) continue
    if (linie.pret === null) {
      faraPret += 1
      continue
    }
    const pierderi = numar(linie.procentPierderi) ?? 0
    total += cantitate * (1 + pierderi / 100) * linie.pret
  }

  const dim = dimensiuni.find((d) => d.id === dimensiuneId)
  const incomplet = faraPret > 0 || cuFormula > 0

  return (
    <span
      className="text-sm text-ink-secondary"
      title={
        incomplet
          ? `Minim: ${faraPret} linii fără preț în nomenclator` +
            (cuFormula > 0 ? `, ${cuFormula} cu formulă` : '')
          : `Cost material pe bucată${dim === undefined ? '' : `, dimensiunea ${dim.cod}`}`
      }
    >
      <span className="font-semibold tabular-nums text-ink">{lei(total)} lei</span>
      <span className="text-ink-muted"> / bucată{incomplet ? ' (minim)' : ''}</span>
    </span>
  )
}
