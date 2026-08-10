import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { apel, EroareApi } from '../lib/api.js'

interface RandModel {
  id: string
  cod: string
  denumire: string
  nrDimensiuni: number
}

interface Dimensiune {
  id: string
  cod: string
  codSagaProdus: string | null
}

interface LinieVariabila {
  id: string
  nrLinie: number
  grup: string
  um: string
  categorieVariabila: string | null
}

interface Consum {
  codSaga: string
  denumire: string
  um: string
  gestiuneDescarcare: string | null
  cantitateNeta: string
  cantitateBruta: string
  cantitateBrutaRotunjita: string
  sursa: string
}

interface RandBon {
  id: string
  nrDoc: string | null
  data: string
  cantitate: string
  status: string
  modelCod: string
  modelDenumire: string
  dimensiuneCod: string
  codSagaProdus: string
  denumireProdus: string | null
}

interface Articol {
  codSaga: string
  denumire: string
  um: string
}

const AZI = new Date().toISOString().slice(0, 10)

export function Bonuri({ utilizator }: { utilizator: UtilizatorCurent }) {
  const poateEmite = utilizator.rol !== 'contabil'
  const poateExporta = utilizator.rol !== 'tehnolog'

  return (
    <section className="space-y-8">
      {poateEmite && <BonNou />}
      <ListaBonuri poateExporta={poateExporta} />
    </section>
  )
}

function BonNou() {
  const queryClient = useQueryClient()
  const [modelId, setModelId] = useState('')
  const [dimensiuneId, setDimensiuneId] = useState('')
  const [cantitate, setCantitate] = useState('1')
  const [data, setData] = useState(AZI)
  const [nrDoc, setNrDoc] = useState('')
  const [gestiuneProdus, setGestiuneProdus] = useState('MATERII PRIME')
  const [alegeri, setAlegeri] = useState<Record<string, string>>({})

  const modele = useQuery({
    queryKey: ['modele'],
    queryFn: () => apel<RandModel[]>('/modele'),
  })

  const context = useQuery({
    queryKey: ['bon-context', modelId, dimensiuneId],
    queryFn: () =>
      apel<{ dimensiuni: Dimensiune[]; liniiVariabile: LinieVariabila[] }>(
        `/bonuri/context/${modelId}${dimensiuneId === '' ? '' : `?dimensiuneId=${dimensiuneId}`}`,
      ),
    enabled: modelId !== '',
  })

  // Choosing another model invalidates the dimension and every material picked.
  useEffect(() => {
    setDimensiuneId('')
    setAlegeri({})
  }, [modelId])

  const dimensiune = context.data?.dimensiuni.find((d) => d.id === dimensiuneId)
  const liniiVariabile = context.data?.liniiVariabile ?? []
  const toateAlese = liniiVariabile.every((l) => (alegeri[l.id] ?? '') !== '')

  const previzualizare = useMutation({
    mutationFn: () =>
      apel<{ linii: Consum[] }>('/bonuri/previzualizare', {
        metoda: 'POST',
        corp: { modelId, dimensiuneId, cantitate, alegeri },
      }),
  })

  const salveaza = useMutation({
    mutationFn: () =>
      apel('/bonuri', {
        metoda: 'POST',
        corp: {
          modelId,
          dimensiuneId,
          cantitate,
          data,
          nrDoc: nrDoc === '' ? null : nrDoc,
          gestiuneProdus,
          alegeri,
        },
      }),
    onSuccess: async () => {
      previzualizare.reset()
      await queryClient.invalidateQueries({ queryKey: ['bonuri'] })
    },
  })

  const gata = modelId !== '' && dimensiuneId !== '' && toateAlese && cantitate !== ''

  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">Bon de predare nou</h2>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">Model</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-64 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">alege…</option>
            {modele.data?.map((m) => (
              <option key={m.id} value={m.id} disabled={m.nrDimensiuni === 0}>
                {m.denumire} {m.nrDimensiuni === 0 ? '(fără dimensiuni)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">Dimensiune</span>
          <select
            value={dimensiuneId}
            disabled={modelId === ''}
            onChange={(e) => setDimensiuneId(e.target.value)}
            className="w-44 rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
          >
            <option value="">alege…</option>
            {context.data?.dimensiuni.map((d) => (
              <option key={d.id} value={d.id}>
                {d.cod}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">Cantitate</span>
          <input
            value={cantitate}
            onChange={(e) => setCantitate(e.target.value)}
            className="w-24 rounded-md border border-neutral-300 px-3 py-2 text-right text-sm tabular-nums"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">Data</span>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">Nr. document</span>
          <input
            value={nrDoc}
            onChange={(e) => setNrDoc(e.target.value)}
            placeholder="opțional"
            className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">Gestiune produs</span>
          <input
            value={gestiuneProdus}
            onChange={(e) => setGestiuneProdus(e.target.value)}
            className="w-44 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {dimensiune !== undefined && dimensiune.codSagaProdus === null && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Dimensiunea {dimensiune.cod} nu are cod de produs finit în SAGA. Leagă-l la „Modele și
          rețete" înainte de a emite bonul.
        </p>
      )}

      {liniiVariabile.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-sm font-semibold text-blue-900">Materiale de ales</h3>
          <p className="mt-1 text-sm text-blue-800">
            Rețeta dă metrajul; codul concret se alege acum. Același model în altă stofă
            folosește aceeași rețetă.
          </p>
          <ul className="mt-3 space-y-2">
            {liniiVariabile.map((linie) => (
              <li key={linie.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-neutral-700">
                  linia {linie.nrLinie} · {linie.grup} · {linie.um}
                </span>
                <CautaArticol
                  categorie={linie.categorieVariabila}
                  valoare={alegeri[linie.id] ?? ''}
                  onAlege={(cod) => setAlegeri((a) => ({ ...a, [linie.id]: cod }))}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!gata || previzualizare.isPending}
          onClick={() => previzualizare.mutate()}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          {previzualizare.isPending ? 'Se calculează…' : 'Previzualizează consumurile'}
        </button>
        <button
          type="button"
          disabled={!gata || !previzualizare.isSuccess || salveaza.isPending}
          onClick={() => salveaza.mutate()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {salveaza.isPending ? 'Se salvează…' : 'Salvează bonul'}
        </button>
      </div>

      {previzualizare.isError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {(previzualizare.error as EroareApi).message}
        </p>
      )}
      {salveaza.isError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {(salveaza.error as EroareApi).message}
        </p>
      )}
      {salveaza.isSuccess && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          Bonul a fost salvat. Îl găsești mai jos, gata de export.
        </p>
      )}

      {previzualizare.data !== undefined && (
        <TabelConsumuri linii={previzualizare.data.linii} />
      )}
    </div>
  )
}

function TabelConsumuri({ linii }: { linii: Consum[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">Cod</th>
            <th className="px-4 py-2 font-medium">Denumire</th>
            <th className="px-4 py-2 font-medium">UM</th>
            <th className="px-4 py-2 text-right font-medium">Net</th>
            <th className="px-4 py-2 text-right font-medium">Brut</th>
            <th className="px-4 py-2 text-right font-medium">În fișier</th>
            <th className="px-4 py-2 font-medium">Sursă</th>
          </tr>
        </thead>
        <tbody>
          {linii.map((linie) => (
            <tr key={linie.codSaga} className="border-b border-neutral-100 last:border-0">
              <td className="px-4 py-2 font-mono text-xs">{linie.codSaga}</td>
              <td className="px-4 py-2">{linie.denumire}</td>
              <td className="px-4 py-2 text-neutral-600">{linie.um}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                {linie.cantitateNeta}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                {linie.cantitateBruta}
              </td>
              <td className="px-4 py-2 text-right font-medium tabular-nums">
                {linie.cantitateBrutaRotunjita}
              </td>
              <td className="px-4 py-2">
                <span
                  className={
                    linie.sursa === 'override'
                      ? 'rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800'
                      : 'text-xs text-neutral-500'
                  }
                >
                  {linie.sursa}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Type-ahead over 21.600 articles; the list only loads once there is a query. */
function CautaArticol({
  categorie,
  valoare,
  onAlege,
}: {
  categorie: string | null
  valoare: string
  onAlege: (cod: string) => void
}) {
  const [text, setText] = useState('')
  const [amanat, setAmanat] = useState('')

  useEffect(() => {
    const cronometru = setTimeout(() => setAmanat(text), 300)
    return () => clearTimeout(cronometru)
  }, [text])

  const rezultate = useQuery({
    queryKey: ['cauta-articol', amanat, categorie],
    queryFn: () => {
      // Deliberately not filtered by category: `grupa` is empty in every row of
      // the SAGA export, so every article has a null category and the filter
      // would return nothing at all. The category stays a hint in the
      // placeholder until somebody fills those in.
      const parametri = new URLSearchParams({
        cauta: amanat,
        tip: 'materie_prima',
        // Articles without a unit exist in the catalogue and SAGA refuses them
        // on import, so they are not offered here at all.
        doarUtilizabile: 'true',
        pePagina: '10',
      })
      return apel<{ articole: Articol[] }>(`/nomenclator?${parametri.toString()}`)
    },
    enabled: amanat.trim().length >= 2 && valoare === '',
  })

  if (valoare !== '') {
    return (
      <span className="flex items-center gap-2">
        <span className="rounded bg-white px-2 py-1 font-mono text-xs">{valoare}</span>
        <button
          type="button"
          onClick={() => {
            onAlege('')
            setText('')
          }}
          className="text-xs text-blue-700 underline"
        >
          schimbă
        </button>
      </span>
    )
  }

  return (
    <span className="relative">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={categorie === null ? 'caută material…' : `caută în ${categorie}…`}
        className="w-64 rounded-md border border-neutral-300 px-2 py-1 text-sm"
      />
      {(rezultate.data?.articole.length ?? 0) > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-80 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {rezultate.data?.articole.map((a) => (
            <li key={a.codSaga}>
              <button
                type="button"
                onClick={() => onAlege(a.codSaga)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-mono text-xs text-neutral-500">{a.codSaga}</span>{' '}
                {a.denumire} <span className="text-xs text-neutral-400">({a.um})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

function ListaBonuri({ poateExporta }: { poateExporta: boolean }) {
  const queryClient = useQueryClient()
  const [selectate, setSelectate] = useState<string[]>([])
  const [confirmaReexport, setConfirmaReexport] = useState(false)

  const bonuri = useQuery({
    queryKey: ['bonuri'],
    queryFn: () => apel<RandBon[]>('/bonuri'),
  })

  const exporta = useMutation({
    mutationFn: () =>
      apel<{ id: string; nrLinii: number; nrBonuri: number }>('/export', {
        metoda: 'POST',
        corp: { bonIds: selectate, confirmaReexport },
      }),
    onSuccess: async (lot) => {
      setSelectate([])
      setConfirmaReexport(false)
      await queryClient.invalidateQueries({ queryKey: ['bonuri'] })
      const { url } = await apel<{ url: string }>(`/export/${lot.id}/descarcare`)
      window.location.assign(url)
    },
  })

  function comuta(id: string) {
    setSelectate((curente) =>
      curente.includes(id) ? curente.filter((x) => x !== id) : [...curente, id],
    )
  }

  const conflict = exporta.error instanceof EroareApi && exporta.error.status === 409

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">Bonuri</h2>
        {poateExporta && (
          <button
            type="button"
            disabled={selectate.length === 0 || exporta.isPending}
            onClick={() => exporta.mutate()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {exporta.isPending
              ? 'Se generează…'
              : `Exportă ${selectate.length} bon${selectate.length === 1 ? '' : 'uri'}`}
          </button>
        )}
      </div>

      {exporta.isError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="text-amber-900">{(exporta.error as EroareApi).message}</p>
          {conflict && (
            <label className="mt-2 flex items-center gap-2 text-amber-900">
              <input
                type="checkbox"
                checked={confirmaReexport}
                onChange={(e) => setConfirmaReexport(e.target.checked)}
              />
              Da, trimite-le din nou în SAGA.
            </label>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-4 py-2 font-medium">Data</th>
              <th className="px-4 py-2 font-medium">Produs</th>
              <th className="px-4 py-2 font-medium">Dimensiune</th>
              <th className="px-4 py-2 text-right font-medium">Cantitate</th>
              <th className="px-4 py-2 font-medium">Stare</th>
            </tr>
          </thead>
          <tbody>
            {bonuri.data?.map((bon) => (
              <tr key={bon.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2">
                  {poateExporta && bon.status !== 'anulat' && (
                    <input
                      type="checkbox"
                      checked={selectate.includes(bon.id)}
                      onChange={() => comuta(bon.id)}
                    />
                  )}
                </td>
                <td className="px-4 py-2 text-neutral-600">{bon.data}</td>
                <td className="px-4 py-2">
                  {bon.modelDenumire}
                  <span className="ml-2 font-mono text-xs text-neutral-400">
                    {bon.codSagaProdus}
                  </span>
                </td>
                <td className="px-4 py-2 text-neutral-600">{bon.dimensiuneCod}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(bon.cantitate)}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      bon.status === 'exportat'
                        ? 'rounded-full bg-green-50 px-2 py-1 text-xs text-green-700'
                        : bon.status === 'anulat'
                          ? 'rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-500'
                          : 'rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700'
                    }
                  >
                    {bon.status}
                  </span>
                </td>
              </tr>
            ))}
            {bonuri.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-neutral-500">
                  Niciun bon încă.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
