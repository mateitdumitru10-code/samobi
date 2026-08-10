import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ChangeEvent } from 'react'

import { apel, EroareApi, incarcaFisier } from '../lib/api.js'

interface Articol {
  codSaga: string
  denumire: string
  um: string
  umNormalizat: string | null
  tip: string
  cont: string | null
  gestiuneImplicita: string | null
  categorie: string | null
  pretReferinta: string | null
  activ: boolean
  sincronizatLa: string | null
}

interface Pagina {
  total: number
  pagina: number
  pePagina: number
  articole: Articol[]
}

interface Raport {
  fisier: string
  randuriInFisier: number
  articoleInFisier: number
  noi: number
  modificate: number
  neschimbate: number
  disparute: number
  exempleNoi: { codSaga: string; denumire: string }[]
  exempleModificate: { codSaga: string; denumire: string; schimbari: string[] }[]
  umNecunoscute: { um: string; articole: number }[]
}

interface Nemapat {
  id: string
  denumireExterna: string
  sugestii: { codSaga: string; denumire: string; scor: number }[]
}

const ETICHETE_TIP: Record<string, string> = {
  produs: 'Produs finit',
  materie_prima: 'Materie primă',
  marfa: 'Marfă',
  altele: 'Altele',
}

const PE_PAGINA = 50

export function Nomenclator({ utilizator }: { utilizator: UtilizatorCurent }) {
  const queryClient = useQueryClient()
  const poateImporta = utilizator.rol === 'admin' || utilizator.rol === 'tehnolog'

  const [cauta, setCauta] = useState('')
  const [cautaAmanat, setCautaAmanat] = useState('')
  const [tip, setTip] = useState('')
  const [categorie, setCategorie] = useState('')
  const [gestiune, setGestiune] = useState('')
  const [pagina, setPagina] = useState(1)
  const [raport, setRaport] = useState<Raport | null>(null)

  // Typing in a 21.600-row catalogue should not fire a query per keystroke.
  useEffect(() => {
    const cronometru = setTimeout(() => {
      setCautaAmanat(cauta)
      setPagina(1)
    }, 300)
    return () => clearTimeout(cronometru)
  }, [cauta])

  const filtre = useQuery({
    queryKey: ['nomenclator', 'filtre'],
    queryFn: () => apel<{ categorii: string[]; gestiuni: string[] }>('/nomenclator/filtre'),
    staleTime: 5 * 60_000,
  })

  const articole = useQuery({
    queryKey: ['nomenclator', { cautaAmanat, tip, categorie, gestiune, pagina }],
    queryFn: () => {
      const parametri = new URLSearchParams({
        pagina: String(pagina),
        pePagina: String(PE_PAGINA),
      })
      if (cautaAmanat !== '') parametri.set('cauta', cautaAmanat)
      if (tip !== '') parametri.set('tip', tip)
      if (categorie !== '') parametri.set('categorie', categorie)
      if (gestiune !== '') parametri.set('gestiune', gestiune)
      return apel<Pagina>(`/nomenclator?${parametri.toString()}`)
    },
    placeholderData: keepPreviousData,
  })

  const nemapate = useQuery({
    queryKey: ['nomenclator', 'nemapate'],
    queryFn: () => apel<Nemapat[]>('/nomenclator/nemapate'),
  })

  const importa = useMutation({
    mutationFn: (fisier: File) => incarcaFisier<Raport>('/nomenclator/import', fisier),
    onSuccess: async (rezultat) => {
      setRaport(rezultat)
      await queryClient.invalidateQueries({ queryKey: ['nomenclator'] })
    },
  })

  const rezolva = useMutation({
    mutationFn: (v: { id: string; codSaga: string }) =>
      apel(`/nomenclator/nemapate/${v.id}/rezolvare`, { metoda: 'POST', corp: { codSaga: v.codSaga } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nomenclator', 'nemapate'] }),
  })

  function alegeFisier(eveniment: ChangeEvent<HTMLInputElement>) {
    const fisier = eveniment.target.files?.[0]
    if (fisier !== undefined) importa.mutate(fisier)
    eveniment.target.value = ''
  }

  const total = articole.data?.total ?? 0
  const ultimaPagina = Math.max(1, Math.ceil(total / PE_PAGINA))

  return (
    <section className="space-y-8">
      {poateImporta && (
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-neutral-900">Import nomenclator</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Exportă articolele din SAGA în XLSX și încarcă fișierul aici. Nimic nu se scrie
            înapoi în SAGA.
          </p>

          <label className="mt-4 inline-block cursor-pointer rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
            {importa.isPending ? 'Se importă…' : 'Alege fișier XLSX'}
            <input
              type="file"
              accept=".xlsx"
              onChange={alegeFisier}
              disabled={importa.isPending}
              className="hidden"
            />
          </label>

          {importa.isError && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {importa.error instanceof EroareApi ? importa.error.message : 'Import eșuat.'}
            </p>
          )}

          {raport !== null && <RaportImport raport={raport} />}
        </div>
      )}

      {(nemapate.data?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">
            Materiale fără corespondent ({nemapate.data?.length})
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Blochează exportul bonurilor care le folosesc. Alege articolul potrivit.
          </p>

          <ul className="mt-4 space-y-3">
            {nemapate.data?.map((intrare) => (
              <li key={intrare.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-neutral-900">{intrare.denumireExterna}</span>
                <select
                  defaultValue=""
                  disabled={!poateImporta || rezolva.isPending}
                  onChange={(e) =>
                    e.target.value !== '' &&
                    rezolva.mutate({ id: intrare.id, codSaga: e.target.value })
                  }
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
                >
                  <option value="">Alege articolul…</option>
                  {intrare.sugestii.map((s) => (
                    <option key={s.codSaga} value={s.codSaga}>
                      {s.codSaga} · {s.denumire} ({Math.round(s.scor * 100)}%)
                    </option>
                  ))}
                </select>
                {intrare.sugestii.length === 0 && (
                  <span className="text-xs text-amber-700">nicio sugestie apropiată</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-neutral-600">Caută</span>
            <input
              value={cauta}
              onChange={(e) => setCauta(e.target.value)}
              placeholder="denumire sau cod"
              className="w-72 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-medium text-neutral-600">Tip</span>
            <select
              value={tip}
              onChange={(e) => {
                setTip(e.target.value)
                setPagina(1)
              }}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">toate</option>
              {Object.entries(ETICHETE_TIP).map(([valoare, eticheta]) => (
                <option key={valoare} value={valoare}>
                  {eticheta}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-medium text-neutral-600">Gestiune</span>
            <select
              value={gestiune}
              onChange={(e) => {
                setGestiune(e.target.value)
                setPagina(1)
              }}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">toate</option>
              {filtre.data?.gestiuni.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          {(filtre.data?.categorii.length ?? 0) > 0 && (
            <label className="space-y-1">
              <span className="block text-xs font-medium text-neutral-600">Categorie</span>
              <select
                value={categorie}
                onChange={(e) => {
                  setCategorie(e.target.value)
                  setPagina(1)
                }}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              >
                <option value="">toate</option>
                {filtre.data?.categorii.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}

          <span className="pb-2 text-sm text-neutral-500">
            {articole.isLoading ? 'se încarcă…' : `${total.toLocaleString('ro-RO')} articole`}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Cod</th>
                <th className="px-4 py-3 font-medium">Denumire</th>
                <th className="px-4 py-3 font-medium">UM</th>
                <th className="px-4 py-3 font-medium">Tip</th>
                <th className="px-4 py-3 font-medium">Gestiune</th>
                <th className="px-4 py-3 text-right font-medium">Preț</th>
              </tr>
            </thead>
            <tbody>
              {articole.data?.articole.map((articol) => (
                <tr key={articol.codSaga} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{articol.codSaga}</td>
                  <td className="px-4 py-2">{articol.denumire}</td>
                  <td className="px-4 py-2">
                    {articol.um}
                    {articol.umNormalizat !== null && articol.umNormalizat !== articol.um && (
                      <span className="ml-1 text-xs text-neutral-400">
                        → {articol.umNormalizat}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {ETICHETE_TIP[articol.tip] ?? articol.tip}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{articol.gestiuneImplicita ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                    {articol.pretReferinta === null
                      ? '—'
                      : Number(articol.pretReferinta).toLocaleString('ro-RO', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                  </td>
                </tr>
              ))}
              {articole.data?.articole.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-neutral-500">
                    Niciun articol pentru filtrele alese.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {ultimaPagina > 1 && (
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => p - 1)}
              className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Înapoi
            </button>
            <span className="text-neutral-500">
              pagina {pagina} din {ultimaPagina}
            </span>
            <button
              type="button"
              disabled={pagina >= ultimaPagina}
              onClick={() => setPagina((p) => p + 1)}
              className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Înainte
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function RaportImport({ raport }: { raport: Raport }) {
  return (
    <div className="mt-4 space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm">
      <p className="font-medium text-neutral-900">{raport.fisier}</p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <Cifra eticheta="rânduri în fișier" valoare={raport.randuriInFisier} />
        <Cifra eticheta="articole distincte" valoare={raport.articoleInFisier} />
        <Cifra eticheta="noi" valoare={raport.noi} />
        <Cifra eticheta="modificate" valoare={raport.modificate} />
        <Cifra eticheta="neschimbate" valoare={raport.neschimbate} />
        <Cifra eticheta="dispărute" valoare={raport.disparute} />
      </dl>

      {raport.exempleModificate.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-neutral-500">Exemple de modificări</p>
          <ul className="mt-1 space-y-0.5 text-neutral-700">
            {raport.exempleModificate.slice(0, 8).map((e) => (
              <li key={e.codSaga}>
                <span className="font-mono text-xs">{e.codSaga}</span> {e.denumire}{' '}
                <span className="text-neutral-500">({e.schimbari.join(', ')})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {raport.umNecunoscute.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-neutral-500">
            Unități pe care aplicația nu le recunoaște
          </p>
          <p className="mt-1 text-neutral-700">
            {raport.umNecunoscute
              .slice(0, 10)
              .map((u) => `${u.um} (${u.articole})`)
              .join(' · ')}
          </p>
        </div>
      )}
    </div>
  )
}

function Cifra({ eticheta, valoare }: { eticheta: string; valoare: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-neutral-500">{eticheta}</dt>
      <dd className="font-medium tabular-nums text-neutral-900">
        {valoare.toLocaleString('ro-RO')}
      </dd>
    </div>
  )
}
