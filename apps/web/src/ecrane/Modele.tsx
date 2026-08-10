import { FAMILII } from '@samobi/shared/db'
import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { apel, type EroareApi } from '../lib/api.js'

import { RetetaEditor } from './RetetaEditor.js'

interface RandModel {
  id: string
  cod: string
  denumire: string
  familie: string
  umProdus: string
  activ: boolean
  nrDimensiuni: number
  nrRetete: number
}

interface Dimensiune {
  id: string
  cod: string
  lungime: string
  latime: string
  inaltime: string | null
  codSagaProdus: string | null
  denumireProdus: string | null
  activ: boolean
}

interface Detaliu extends RandModel {
  dimensiuni: Dimensiune[]
}

/** Trailing zeros from numeric(18,6) help nobody read 2000.000000. */
function mm(valoare: string | null): string {
  if (valoare === null) return '—'
  return String(Number(valoare))
}

export function Modele({ utilizator }: { utilizator: UtilizatorCurent }) {
  const poateEdita = utilizator.rol === 'admin' || utilizator.rol === 'tehnolog'
  const [selectat, setSelectat] = useState<string | null>(null)

  const modele = useQuery({
    queryKey: ['modele'],
    queryFn: () => apel<RandModel[]>('/modele'),
  })

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-6">
        <div className="w-full max-w-xs space-y-3">
          {poateEdita && <FormularModel />}

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <ul className="divide-y divide-neutral-100">
              {modele.data?.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelectat(m.id)}
                    className={
                      selectat === m.id
                        ? 'w-full bg-neutral-100 px-4 py-3 text-left'
                        : 'w-full px-4 py-3 text-left hover:bg-neutral-50'
                    }
                  >
                    <span className="block text-sm font-medium text-neutral-900">{m.denumire}</span>
                    <span className="block font-mono text-xs text-neutral-400">{m.cod}</span>
                    <span className="mt-1 block text-xs text-neutral-500">
                      {m.familie} · {m.nrDimensiuni} dimensiuni
                      {m.nrRetete === 0 && <span className="text-amber-700"> · fără rețetă</span>}
                    </span>
                  </button>
                </li>
              ))}
              {modele.data?.length === 0 && (
                <li className="px-4 py-6 text-sm text-neutral-500">
                  Niciun model încă. Începe cu unul.
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {selectat === null ? (
            <p className="text-sm text-neutral-500">
              Alege un model din stânga ca să-i vezi dimensiunile și rețeta.
            </p>
          ) : (
            <DetaliuModel modelId={selectat} poateEdita={poateEdita} utilizator={utilizator} />
          )}
        </div>
      </div>
    </section>
  )
}

function FormularModel() {
  const queryClient = useQueryClient()
  const [cod, setCod] = useState('')
  const [denumire, setDenumire] = useState('')
  const [familie, setFamilie] = useState<string>('PAT')

  const creeaza = useMutation({
    mutationFn: () => apel('/modele', { metoda: 'POST', corp: { cod, denumire, familie } }),
    onSuccess: async () => {
      setCod('')
      setDenumire('')
      await queryClient.invalidateQueries({ queryKey: ['modele'] })
    },
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    creeaza.mutate()
  }

  return (
    <form onSubmit={trimite} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Model nou</h2>

      <input
        value={cod}
        onChange={(e) => setCod(e.target.value.toUpperCase())}
        placeholder="PAT-DAVID"
        required
        className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900"
      />
      <input
        value={denumire}
        onChange={(e) => setDenumire(e.target.value)}
        placeholder="PAT DAVID SOMIERA"
        required
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <select
        value={familie}
        onChange={(e) => setFamilie(e.target.value)}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      >
        {FAMILII.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      {creeaza.isError && (
        <p className="text-sm text-red-700">{(creeaza.error as EroareApi).message}</p>
      )}

      <button
        type="submit"
        disabled={creeaza.isPending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {creeaza.isPending ? 'Se creează…' : 'Creează modelul'}
      </button>
    </form>
  )
}

function DetaliuModel({
  modelId,
  poateEdita,
  utilizator,
}: {
  modelId: string
  poateEdita: boolean
  utilizator: UtilizatorCurent
}) {
  const detaliu = useQuery({
    queryKey: ['model', modelId],
    queryFn: () => apel<Detaliu>(`/modele/${modelId}`),
  })

  if (detaliu.isLoading) return <p className="text-sm text-neutral-500">Se încarcă…</p>
  if (detaliu.data === undefined) return null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900">{detaliu.data.denumire}</h2>
        <p className="font-mono text-xs text-neutral-400">{detaliu.data.cod}</p>
      </div>

      <Dimensiuni modelId={modelId} dimensiuni={detaliu.data.dimensiuni} poateEdita={poateEdita} />

      <div>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Rețetă</h3>
        <RetetaEditor modelId={modelId} poateEdita={poateEdita} utilizator={utilizator} />
      </div>
    </div>
  )
}

function Dimensiuni({
  modelId,
  dimensiuni,
  poateEdita,
}: {
  modelId: string
  dimensiuni: Dimensiune[]
  poateEdita: boolean
}) {
  const queryClient = useQueryClient()
  const [deschis, setDeschis] = useState(false)
  const [cod, setCod] = useState('')
  const [lungime, setLungime] = useState('')
  const [latime, setLatime] = useState('')
  const [inaltime, setInaltime] = useState('')
  const [codSagaProdus, setCodSagaProdus] = useState('')

  const creeaza = useMutation({
    mutationFn: () =>
      apel(`/modele/${modelId}/dimensiuni`, {
        metoda: 'POST',
        corp: {
          cod,
          lungime,
          latime,
          inaltime: inaltime === '' ? null : inaltime,
          codSagaProdus: codSagaProdus === '' ? null : codSagaProdus,
        },
      }),
    onSuccess: async () => {
      setCod('')
      setLungime('')
      setLatime('')
      setInaltime('')
      setCodSagaProdus('')
      setDeschis(false)
      await queryClient.invalidateQueries({ queryKey: ['model', modelId] })
      await queryClient.invalidateQueries({ queryKey: ['reteta', modelId] })
    },
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    creeaza.mutate()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">Dimensiuni</h3>
        {poateEdita && (
          <button
            type="button"
            onClick={() => setDeschis((d) => !d)}
            className="rounded-md border border-neutral-300 px-3 py-1 text-xs"
          >
            {deschis ? 'Renunță' : 'Adaugă dimensiune'}
          </button>
        )}
      </div>

      {deschis && (
        <form
          onSubmit={trimite}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-4"
        >
          <Camp eticheta="Cod" valoare={cod} set={setCod} latime="w-32" placeholder="2000x1600" />
          <Camp eticheta="Lungime (mm)" valoare={lungime} set={setLungime} latime="w-28" placeholder="2000" />
          <Camp eticheta="Lățime (mm)" valoare={latime} set={setLatime} latime="w-28" placeholder="1600" />
          <Camp eticheta="Înălțime (mm)" valoare={inaltime} set={setInaltime} latime="w-28" placeholder="350" optional />
          <Camp
            eticheta="Cod SAGA produs"
            valoare={codSagaProdus}
            set={setCodSagaProdus}
            latime="w-36"
            placeholder="00022107"
            optional
          />
          <button
            type="submit"
            disabled={creeaza.isPending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Adaugă
          </button>
          {creeaza.isError && (
            <p className="w-full text-sm text-red-700">{(creeaza.error as EroareApi).message}</p>
          )}
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Cod</th>
              <th className="px-4 py-2 font-medium">L × l × H (mm)</th>
              <th className="px-4 py-2 font-medium">Produs finit în SAGA</th>
            </tr>
          </thead>
          <tbody>
            {dimensiuni.map((d) => (
              <tr key={d.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2 font-medium">{d.cod}</td>
                <td className="px-4 py-2 tabular-nums text-neutral-600">
                  {mm(d.lungime)} × {mm(d.latime)}
                  {d.inaltime !== null && ` × ${mm(d.inaltime)}`}
                </td>
                <td className="px-4 py-2 text-neutral-600">
                  {d.codSagaProdus === null ? (
                    <span className="text-amber-700">nelegat — bonul nu se poate emite</span>
                  ) : (
                    <>
                      <span className="font-mono text-xs">{d.codSagaProdus}</span>
                      {d.denumireProdus !== null && (
                        <span className="ml-2 text-neutral-400">{d.denumireProdus}</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {dimensiuni.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-neutral-500">
                  Nicio dimensiune. Rețeta are nevoie de cel puțin una.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Camp({
  eticheta,
  valoare,
  set,
  latime,
  placeholder,
  optional,
}: {
  eticheta: string
  valoare: string
  set: (v: string) => void
  latime: string
  placeholder: string
  optional?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-neutral-600">{eticheta}</span>
      <input
        value={valoare}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        required={optional !== true}
        className={`${latime} rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900`}
      />
    </label>
  )
}
