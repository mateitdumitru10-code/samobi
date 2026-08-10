import { GRUPURI, MODURI_CALCUL } from '@samobi/shared/db'
import type { RezultatValidareFormula, UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { apel, EroareApi } from '../lib/api.js'
import { coordonate, useNavigareGrila } from '../lib/grila.js'

import { Versiuni } from './Versiuni.js'

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
    grup: 'STRUCTURA',
    codSaga: '',
    denumireMaterial: null,
    esteVariabil: false,
    categorieVariabila: '',
    um: 'BUC',
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

/**
 * The quantity a line contributes for one product, where it can be known here.
 *
 * `fixa` and `tabel` are in the grid already. A formula depends on L, l and H,
 * and is evaluated by the server — the check panel below shows it, and the full
 * costing lives in Rapoarte → Antecalculație.
 */
function cantitatePeDimensiune(linie: Linie, dimensiuneId: string): number | null {
  const override = linie.valori[dimensiuneId]
  if (override?.esteOverride === true) return Number(override.cantitate)
  if (linie.modCalcul === 'fixa') {
    return linie.cantitateFixa === '' ? null : Number(linie.cantitateFixa)
  }
  if (linie.modCalcul === 'tabel') {
    return override === undefined ? null : Number(override.cantitate)
  }
  return null
}

/** Which fields a mode actually uses. Everything else is greyed out. */
function campActiv(modCalcul: string, camp: 'cantitateFixa' | 'formula'): boolean {
  if (camp === 'cantitateFixa') return modCalcul === 'fixa'
  return modCalcul === 'formula'
}

export function RetetaEditor({
  modelId,
  poateEdita,
  utilizator,
}: {
  modelId: string
  poateEdita: boolean
  utilizator: UtilizatorCurent
}) {
  const [versiuneAleasa, setVersiuneAleasa] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const navigheaza = useNavigareGrila(() => containerRef.current)

  const [linii, setLinii] = useState<Linie[]>([])
  const [lockVersion, setLockVersion] = useState(0)
  const [modificat, setModificat] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [dimensiunePreview, setDimensiunePreview] = useState('')
  const [linieSelectata, setLinieSelectata] = useState<string | null>(null)

  const reteta = useQuery({
    queryKey: ['reteta', modelId, versiuneAleasa],
    queryFn: () =>
      apel<Reteta>(
        `/modele/${modelId}/reteta${versiuneAleasa === null ? '' : `?versiuneId=${versiuneAleasa}`}`,
      ),
  })

  useEffect(() => {
    if (reteta.data === undefined) return
    setLinii(reteta.data.linii.map(dinServer))
    setLockVersion(reteta.data.lockVersion)
    setModificat(false)
    setConflict(null)
    setDimensiunePreview((curent) =>
      curent === '' ? (reteta.data?.dimensiuni[0]?.id ?? '') : curent,
    )
  }, [reteta.data])

  const dimensiuni = reteta.data?.dimensiuni ?? []

  const salveaza = useMutation({
    mutationFn: () =>
      apel<{ lockVersion: number }>(`/retete/${reteta.data?.id ?? ''}`, {
        metoda: 'PUT',
        corp: {
          lockVersion,
          linii: linii.map((linie) => ({
            nrLinie: linie.nrLinie,
            grup: linie.grup,
            codSaga: linie.esteVariabil ? null : linie.codSaga,
            esteVariabil: linie.esteVariabil,
            categorieVariabila: linie.esteVariabil ? linie.categorieVariabila : null,
            um: linie.um,
            modCalcul: linie.modCalcul,
            cantitateFixa: linie.modCalcul === 'fixa' ? linie.cantitateFixa : null,
            formula: linie.modCalcul === 'formula' ? linie.formula : null,
            procentPierderi: linie.procentPierderi === '' ? '0' : linie.procentPierderi,
            gestiuneDescarcare: linie.gestiuneDescarcare === '' ? null : linie.gestiuneDescarcare,
            obligatoriu: true,
            observatii: linie.observatii === '' ? null : linie.observatii,
            valoriPeDimensiuni: Object.entries(linie.valori)
              .filter(([, v]) => v.cantitate !== '')
              .map(([dimensiuneId, v]) => ({
                dimensiuneId,
                cantitate: v.cantitate,
                esteOverride: v.esteOverride,
                motiv: v.esteOverride ? v.motiv : null,
              })),
          })),
        },
      }),
    onSuccess: async (rezultat) => {
      setLockVersion(rezultat.lockVersion)
      setModificat(false)
      setConflict(null)
      await queryClient.invalidateQueries({ queryKey: ['reteta', modelId] })
    },
    onError: (err) => {
      if (err instanceof EroareApi && err.status === 409) setConflict(err.message)
    },
  })

  function schimba(cheie: string, camp: keyof Linie, valoare: string | boolean) {
    setLinii((curente) =>
      curente.map((linie) => (linie.cheie === cheie ? { ...linie, [camp]: valoare } : linie)),
    )
    setModificat(true)
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
    setModificat(true)
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
    setModificat(true)
  }

  function adauga() {
    setLinii((curente) => [
      ...curente,
      linieNoua(Math.max(0, ...curente.map((l) => l.nrLinie)) + 1),
    ])
    setModificat(true)
  }

  function sterge(cheie: string) {
    setLinii((curente) =>
      curente
        .filter((l) => l.cheie !== cheie)
        .map((l, index) => ({ ...l, nrLinie: index + 1 })),
    )
    setModificat(true)
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
  // Only a draft is editable. Approved recipes are what bons were built on.
  const blocat = !poateEdita || reteta.data?.status !== 'draft'

  if (reteta.isLoading) {
    return <p className="text-sm text-neutral-500">Se încarcă rețeta…</p>
  }
  if (reteta.isError) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {(reteta.error as EroareApi).message}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <Versiuni
        modelId={modelId}
        versiuneCurenta={reteta.data?.id ?? null}
        utilizator={utilizator}
        onSchimbaVersiune={setVersiuneAleasa}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          {modificat && <span className="text-amber-700">modificări nesalvate</span>}
        </div>

        <div className="flex items-center gap-2">
          {!blocat && (
            <button
              type="button"
              onClick={adauga}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Adaugă linie
            </button>
          )}
          {!blocat && (
            <button
              type="button"
              disabled={!modificat || salveaza.isPending || overrideFaraMotiv}
              onClick={() => salveaza.mutate()}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {salveaza.isPending ? 'Se salvează…' : 'Salvează rețeta'}
            </button>
          )}
        </div>
      </div>

      {conflict !== null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-medium text-amber-900">{conflict}</p>
          <button
            type="button"
            onClick={() => void reteta.refetch()}
            className="mt-2 rounded-md border border-amber-400 px-3 py-1 text-xs text-amber-900"
          >
            Reîncarcă rețeta
          </button>
        </div>
      )}

      {salveaza.isError && conflict === null && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {(salveaza.error as EroareApi).message}
        </p>
      )}

      {dimensiuni.length === 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Modelul nu are dimensiuni. Adaugă cel puțin una înainte de rețetă — modul „tabel" și
          previzualizarea formulelor au nevoie de ele.
        </p>
      )}

      <div ref={containerRef} className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Grup</th>
              <th className="px-2 py-2 font-medium">Cod / categorie</th>
              <th className="px-2 py-2 font-medium">UM</th>
              <th className="px-2 py-2 font-medium">Mod</th>
              <th className="px-2 py-2 font-medium">Cantitate</th>
              <th className="px-2 py-2 font-medium">Formulă</th>
              <th className="px-2 py-2 font-medium">Pierderi %</th>
              <th className="px-2 py-2 text-right font-medium">Preț</th>
              <th className="px-2 py-2 text-right font-medium">Valoare</th>
              {dimensiuni.map((d) => (
                <th key={d.id} className="px-2 py-2 font-medium">
                  {d.cod}
                </th>
              ))}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {linii.map((linie, rand) => {
              const areOverride = Object.values(linie.valori).some((v) => v.esteOverride)
              return (
                <tr
                  key={linie.cheie}
                  onFocus={() => setLinieSelectata(linie.cheie)}
                  className={
                    linieSelectata === linie.cheie
                      ? 'border-b border-neutral-100 bg-neutral-50 last:border-0'
                      : 'border-b border-neutral-100 last:border-0'
                  }
                >
                  <td className="px-2 py-1 text-neutral-400">{linie.nrLinie}</td>

                  <td className="px-1 py-1">
                    <select
                      value={linie.grup}
                      disabled={blocat}
                      onChange={(e) => schimba(linie.cheie, 'grup', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, 0)}
                      className="w-32 rounded border border-transparent px-1 py-1 hover:border-neutral-300 focus:border-neutral-900 focus:outline-none"
                    >
                      {GRUPURI.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        value={linie.esteVariabil ? linie.categorieVariabila : linie.codSaga}
                        disabled={blocat}
                        placeholder={linie.esteVariabil ? 'TEXTIL' : '00016024'}
                        onChange={(e) =>
                          schimba(
                            linie.cheie,
                            linie.esteVariabil ? 'categorieVariabila' : 'codSaga',
                            e.target.value,
                          )
                        }
                        onKeyDown={navigheaza}
                        {...coordonate(rand, 1)}
                        className="w-28 rounded border border-transparent px-1 py-1 font-mono text-xs hover:border-neutral-300 focus:border-neutral-900 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={blocat}
                        title="Material variabil: codul se alege la crearea bonului"
                        onClick={() => schimba(linie.cheie, 'esteVariabil', !linie.esteVariabil)}
                        className={
                          linie.esteVariabil
                            ? 'rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800'
                            : 'rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-400'
                        }
                      >
                        var
                      </button>
                    </div>
                    {linie.denumireMaterial !== null && !linie.esteVariabil && (
                      <p className="px-1 text-[11px] text-neutral-400">{linie.denumireMaterial}</p>
                    )}
                  </td>

                  <td className="px-1 py-1">
                    <input
                      value={linie.um}
                      disabled={blocat}
                      onChange={(e) => schimba(linie.cheie, 'um', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, 2)}
                      className="w-16 rounded border border-transparent px-1 py-1 hover:border-neutral-300 focus:border-neutral-900 focus:outline-none"
                    />
                  </td>

                  <td className="px-1 py-1">
                    <select
                      value={linie.modCalcul}
                      disabled={blocat}
                      onChange={(e) => schimba(linie.cheie, 'modCalcul', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, 3)}
                      className="w-24 rounded border border-transparent px-1 py-1 hover:border-neutral-300 focus:border-neutral-900 focus:outline-none"
                    >
                      {MODURI_CALCUL.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-1 py-1">
                    <input
                      value={linie.cantitateFixa}
                      disabled={blocat || !campActiv(linie.modCalcul, 'cantitateFixa')}
                      onChange={(e) => schimba(linie.cheie, 'cantitateFixa', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, 4)}
                      className="w-24 rounded border border-transparent px-1 py-1 text-right tabular-nums hover:border-neutral-300 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-300"
                    />
                  </td>

                  <td className="px-1 py-1">
                    <input
                      value={linie.formula}
                      disabled={blocat || !campActiv(linie.modCalcul, 'formula')}
                      placeholder="2*(L+l)/1000"
                      onChange={(e) => schimba(linie.cheie, 'formula', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, 5)}
                      className="w-52 rounded border border-transparent px-1 py-1 font-mono text-xs hover:border-neutral-300 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-300"
                    />
                  </td>

                  <td className="px-1 py-1">
                    <input
                      value={linie.procentPierderi}
                      disabled={blocat}
                      onChange={(e) => schimba(linie.cheie, 'procentPierderi', e.target.value)}
                      onKeyDown={navigheaza}
                      {...coordonate(rand, 6)}
                      className="w-16 rounded border border-transparent px-1 py-1 text-right tabular-nums hover:border-neutral-300 focus:border-neutral-900 focus:outline-none"
                    />
                  </td>

                  <td className="px-2 py-1 text-right tabular-nums text-neutral-500">
                    {linie.pret === null ? (
                      <span className="text-xs text-amber-700">fără preț</span>
                    ) : (
                      <span
                        title={
                          linie.sursaPret === 'consum'
                            ? `din ultimul consum, ${linie.pretLa ?? ''}`
                            : 'preț mediu din nomenclator'
                        }
                        className={linie.sursaPret === 'consum' ? 'text-blue-700' : ''}
                      >
                        {linie.pret.toLocaleString('ro-RO', { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </td>

                  <td className="px-2 py-1 text-right font-medium tabular-nums">
                    {(() => {
                      const cant = cantitatePeDimensiune(linie, dimensiunePreview)
                      if (linie.pret === null || cant === null) return '—'
                      const pierderi = Number(linie.procentPierderi === '' ? 0 : linie.procentPierderi)
                      return (cant * (1 + pierderi / 100) * linie.pret).toLocaleString('ro-RO', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    })()}
                  </td>

                  {dimensiuni.map((d, index) => {
                    const valoare = linie.valori[d.id]
                    const esteOverride = valoare?.esteOverride === true
                    return (
                      <td key={d.id} className="px-1 py-1">
                        <input
                          value={valoare?.cantitate ?? ''}
                          disabled={blocat}
                          onChange={(e) => schimbaValoare(linie.cheie, d.id, e.target.value)}
                          onKeyDown={navigheaza}
                          {...coordonate(rand, 9 + index)}
                          title={
                            linie.modCalcul === 'tabel'
                              ? 'Cantitatea pe această dimensiune'
                              : 'O valoare aici suprascrie calculul'
                          }
                          className={
                            esteOverride
                              ? 'w-24 rounded border border-amber-400 bg-amber-50 px-1 py-1 text-right font-medium tabular-nums text-amber-900 focus:outline-none'
                              : 'w-24 rounded border border-transparent px-1 py-1 text-right tabular-nums hover:border-neutral-300 focus:border-neutral-900 focus:outline-none'
                          }
                        />
                      </td>
                    )
                  })}

                  <td className="px-2 py-1 text-right">
                    {areOverride && (
                      <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        override
                      </span>
                    )}
                    {!blocat && (
                      <button
                        type="button"
                        onClick={() => sterge(linie.cheie)}
                        className="text-xs text-neutral-400 hover:text-red-600"
                      >
                        șterge
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}

            {linii.length === 0 && (
              <tr>
                <td colSpan={11 + dimensiuni.length} className="px-4 py-6 text-neutral-500">
                  Rețeta nu are linii. Apasă „Adaugă linie".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TotalReteta linii={linii} dimensiuni={dimensiuni} dimensiuneId={dimensiunePreview} />

      {overrideuri.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">
            Valori fixate manual ({overrideuri.length})
          </h3>
          <p className="mt-1 text-sm text-amber-800">
            Bat formula, întotdeauna. Fiecare are nevoie de un motiv — altfel nimeni nu mai știe
            peste un an de ce.
          </p>
          <ul className="mt-3 space-y-2">
            {overrideuri.map((o) => {
              const dim = dimensiuni.find((d) => d.id === o.dimensiuneId)
              return (
                <li key={`${o.linie.cheie}-${o.dimensiuneId}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-neutral-900">
                    linia {o.linie.nrLinie} · {dim?.cod} = {o.valoare.cantitate}
                  </span>
                  <input
                    value={o.valoare.motiv}
                    disabled={blocat}
                    placeholder="motiv (obligatoriu)"
                    onChange={(e) => schimbaMotiv(o.linie.cheie, o.dimensiuneId, e.target.value)}
                    className={
                      o.valoare.motiv.trim() === ''
                        ? 'w-72 rounded-md border border-red-400 bg-white px-2 py-1 text-sm'
                        : 'w-72 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm'
                    }
                  />
                  {o.valoare.setatLa !== null && (
                    <span className="text-xs text-amber-700">
                      fixat la {new Date(o.valoare.setatLa).toLocaleDateString('ro-RO')}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <VerificareFormula
        linii={linii}
        dimensiuni={dimensiuni}
        dimensiuneId={dimensiunePreview}
        onDimensiune={setDimensiunePreview}
      />
    </div>
  )
}

/**
 * Live check of the formula on the focused line, evaluated on a chosen
 * dimension. The number belongs on screen before the recipe is saved, not on a
 * bon three weeks later.
 */
function VerificareFormula({
  linii,
  dimensiuni,
  dimensiuneId,
  onDimensiune,
}: {
  linii: Linie[]
  dimensiuni: Dimensiune[]
  dimensiuneId: string
  onDimensiune: (id: string) => void
}) {
  const formule = linii
    .filter((l) => l.modCalcul === 'formula' && l.formula.trim() !== '')
    .map((l) => ({ nrLinie: l.nrLinie, formula: l.formula, um: l.um }))

  if (formule.length === 0) return null

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-neutral-900">Verificare formule</h3>
        <select
          value={dimensiuneId}
          onChange={(e) => onDimensiune(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        >
          {dimensiuni.map((d) => (
            <option key={d.id} value={d.id}>
              {d.cod} ({d.lungime}×{d.latime}
              {d.inaltime === null ? '' : `×${d.inaltime}`})
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-3 space-y-1.5">
        {formule.map((f) => (
          <RandFormula key={f.nrLinie} {...f} dimensiuneId={dimensiuneId} />
        ))}
      </ul>
    </div>
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
      <span className="text-neutral-400">linia {nrLinie}</span>
      <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{formula}</code>
      {verificare.isFetching && <span className="text-xs text-neutral-400">se verifică…</span>}
      {rezultat?.valida === false && (
        <span className="text-xs text-red-700">{rezultat.mesaj}</span>
      )}
      {rezultat?.previzualizare != null && (
        <span className="text-neutral-700">
          = <span className="font-medium tabular-nums">{rezultat.previzualizare.valoare}</span> {um}
          <span className="ml-2 text-xs text-neutral-400">
            {rezultat.previzualizare.expresieEvaluata}
          </span>
        </span>
      )}
      {rezultat?.valida === true && rezultat.previzualizare === null && rezultat.mesaj !== null && (
        <span className="text-xs text-amber-700">{rezultat.mesaj}</span>
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
    const cant = cantitatePeDimensiune(linie, dimensiuneId)
    if (cant === null) continue
    if (linie.pret === null) {
      faraPret += 1
      continue
    }
    const pierderi = Number(linie.procentPierderi === '' ? 0 : linie.procentPierderi)
    total += cant * (1 + pierderi / 100) * linie.pret
  }

  const dim = dimensiuni.find((d) => d.id === dimensiuneId)

  return (
    <div className="flex flex-wrap items-baseline gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
      <span className="text-neutral-500">
        Cost material pe bucată{dim === undefined ? '' : `, dimensiunea ${dim.cod}`}
      </span>
      <span className="text-lg font-semibold tabular-nums text-neutral-900">
        {total.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
        <span className="text-sm font-normal text-neutral-400">lei</span>
      </span>
      {(faraPret > 0 || cuFormula > 0) && (
        <span className="text-xs text-amber-700">
          minim — {faraPret > 0 && `${faraPret} linii fără preț`}
          {faraPret > 0 && cuFormula > 0 && ', '}
          {cuFormula > 0 && `${cuFormula} cu formulă, calculate în Rapoarte`}
        </span>
      )}
    </div>
  )
}
