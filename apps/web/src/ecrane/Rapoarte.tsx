import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { apel, type EroareApi } from '../lib/api.js'

interface RandModel {
  id: string
  denumire: string
  nrDimensiuni: number
}

interface Dimensiune {
  id: string
  cod: string
}

interface LinieVariabila {
  id: string
  nrLinie: number
  grup: string
  um: string
  categorieVariabila: string | null
}

interface RandCost {
  codSaga: string
  denumire: string
  um: string
  grup: string | null
  cantitateNeta: string
  cantitateBruta: string
  pretUnitar: string | null
  valoareNeta: string | null
  valoarePierderi: string | null
  valoareTotala: string | null
}

interface Antecalculatie {
  versiuneReteta: number
  cantitate: string
  randuri: RandCost[]
  peGrup: { grup: string; valoare: string }[]
  total: { net: string; pierderi: string; total: string; peBucata: string | null }
  acoperire: { linii: number; faraPret: number; procent: number }
}

interface Necesar {
  randuri: {
    codSaga: string
    denumire: string
    um: string
    gestiune: string | null
    necesar: string
    stoc: string | null
    lipsa: string
    pretUnitar: string | null
    valoare: string | null
  }[]
  total: string
  faraPret: number
  faraStoc: number
  stocLa: string | null
}

interface Cost {
  randuri: {
    model: string
    denumire: string
    bonuri: number
    bucati: number
    costNet: string
    costPierderi: string
    costTotal: string
    costPeBucata: string | null
    acoperire: number
  }[]
  total: string
  totalPierderi: string
}

const lei = (v: string | null) =>
  v === null ? '—' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const AZI = new Date().toISOString().slice(0, 10)
const ACUM_O_LUNA = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)

export function Rapoarte({ utilizator }: { utilizator: UtilizatorCurent }) {
  const [raport, setRaport] = useState<'antecalculatie' | 'necesar' | 'cost'>('antecalculatie')

  return (
    <section className="space-y-6">
      <nav className="flex gap-1 border-b border-neutral-200">
        {(
          [
            ['antecalculatie', 'Antecalculație'],
            ['necesar', 'Necesar de aprovizionare'],
            ['cost', 'Cost material'],
          ] as const
        ).map(([cheie, eticheta]) => (
          <button
            key={cheie}
            type="button"
            onClick={() => setRaport(cheie)}
            className={
              raport === cheie
                ? 'border-b-2 border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900'
            }
          >
            {eticheta}
          </button>
        ))}
      </nav>

      {raport === 'antecalculatie' && <PanouAntecalculatie />}
      {raport === 'necesar' && <PanouNecesar />}
      {raport === 'cost' && <PanouCost utilizator={utilizator} />}
    </section>
  )
}

/** Shown wherever a number is a partial answer, because it always is here. */
function Acoperire({ procent, detaliu }: { procent: number; detaliu: string }) {
  if (procent >= 100) return null
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
      Doar <strong>{procent}%</strong> din linii au preț în nomenclator. {detaliu} Restul lipsesc
      din total — cifra de mai jos e un minim, nu costul real.
    </p>
  )
}

function PanouAntecalculatie() {
  const [modelId, setModelId] = useState('')
  const [dimensiuneId, setDimensiuneId] = useState('')
  const [cantitate, setCantitate] = useState('1')
  const [alegeri, setAlegeri] = useState<Record<string, string>>({})

  const modele = useQuery({ queryKey: ['modele'], queryFn: () => apel<RandModel[]>('/modele') })

  const context = useQuery({
    queryKey: ['bon-context', modelId, dimensiuneId],
    queryFn: () =>
      apel<{ dimensiuni: Dimensiune[]; liniiVariabile: LinieVariabila[] }>(
        `/bonuri/context/${modelId}${dimensiuneId === '' ? '' : `?dimensiuneId=${dimensiuneId}`}`,
      ),
    enabled: modelId !== '',
  })

  useEffect(() => {
    setDimensiuneId('')
    setAlegeri({})
  }, [modelId])

  const calculeaza = useMutation({
    mutationFn: () =>
      apel<Antecalculatie>('/rapoarte/antecalculatie', {
        metoda: 'POST',
        corp: { modelId, dimensiuneId, cantitate, alegeri },
      }),
  })

  const variabile = context.data?.liniiVariabile ?? []
  const gata = modelId !== '' && dimensiuneId !== '' && variabile.every((l) => (alegeri[l.id] ?? '') !== '')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
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
                {m.denumire}
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
            className="w-40 rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50"
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

        <button
          type="button"
          disabled={!gata || calculeaza.isPending}
          onClick={() => calculeaza.mutate()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {calculeaza.isPending ? 'Se calculează…' : 'Calculează'}
        </button>
      </div>

      {variabile.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
          <span className="text-blue-900">Materiale variabile de ales: </span>
          {variabile.map((l) => (
            <input
              key={l.id}
              value={alegeri[l.id] ?? ''}
              onChange={(e) => setAlegeri((a) => ({ ...a, [l.id]: e.target.value }))}
              placeholder={`cod pentru linia ${l.nrLinie}`}
              className="ml-2 w-40 rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs"
            />
          ))}
        </div>
      )}

      {calculeaza.isError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {(calculeaza.error as EroareApi).message}
        </p>
      )}

      {calculeaza.data !== undefined && (
        <>
          <Acoperire
            procent={calculeaza.data.acoperire.procent}
            detaliu={`${calculeaza.data.acoperire.faraPret} din ${calculeaza.data.acoperire.linii} materiale n-au preț.`}
          />

          <div className="flex flex-wrap gap-4">
            <Cifra eticheta="Material net" valoare={calculeaza.data.total.net} />
            <Cifra eticheta="Pierderi din croială" valoare={calculeaza.data.total.pierderi} />
            <Cifra eticheta="Total" valoare={calculeaza.data.total.total} accent />
            <Cifra eticheta="Pe bucată" valoare={calculeaza.data.total.peBucata} accent />
          </div>

          <div className="flex flex-wrap gap-2">
            {calculeaza.data.peGrup.map((g) => (
              <span key={g.grup} className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm">
                {g.grup} <span className="font-medium tabular-nums">{lei(g.valoare)}</span>
              </span>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Cod</th>
                  <th className="px-4 py-2 font-medium">Denumire</th>
                  <th className="px-4 py-2 font-medium">Grup</th>
                  <th className="px-4 py-2 text-right font-medium">Net</th>
                  <th className="px-4 py-2 text-right font-medium">Brut</th>
                  <th className="px-4 py-2 text-right font-medium">Preț</th>
                  <th className="px-4 py-2 text-right font-medium">Valoare</th>
                </tr>
              </thead>
              <tbody>
                {calculeaza.data.randuri.map((r) => (
                  <tr
                    key={r.codSaga}
                    className={
                      r.pretUnitar === null
                        ? 'border-b border-neutral-100 bg-amber-50/50 last:border-0'
                        : 'border-b border-neutral-100 last:border-0'
                    }
                  >
                    <td className="px-4 py-2 font-mono text-xs">{r.codSaga}</td>
                    <td className="px-4 py-2">{r.denumire}</td>
                    <td className="px-4 py-2 text-xs text-neutral-500">{r.grup ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                      {Number(r.cantitateNeta)} {r.um}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {Number(r.cantitateBruta)} {r.um}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                      {r.pretUnitar === null ? (
                        <span className="text-amber-700">fără preț</span>
                      ) : (
                        lei(r.pretUnitar)
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {lei(r.valoareTotala)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function PanouNecesar() {
  const necesar = useQuery({
    queryKey: ['necesar'],
    queryFn: () => apel<Necesar>('/rapoarte/necesar?status=calculat'),
  })

  if (necesar.isLoading) return <p className="text-sm text-neutral-500">Se calculează…</p>
  if (necesar.data === undefined) return null

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Materialele cerute de bonurile calculate și neexportate încă, minus stocul.
        {necesar.data.stocLa !== null &&
          ` Stocul e cel din importul de nomenclator din ${new Date(necesar.data.stocLa).toLocaleDateString('ro-RO')}.`}
      </p>

      {(necesar.data.faraStoc > 0 || necesar.data.faraPret > 0) && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {necesar.data.faraStoc} materiale n-au stoc cunoscut (cerute integral), {necesar.data.faraPret}{' '}
          n-au preț.
        </p>
      )}

      <Cifra eticheta="De cumpărat" valoare={necesar.data.total} accent />

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Cod</th>
              <th className="px-4 py-2 font-medium">Denumire</th>
              <th className="px-4 py-2 font-medium">Gestiune</th>
              <th className="px-4 py-2 text-right font-medium">Necesar</th>
              <th className="px-4 py-2 text-right font-medium">Stoc</th>
              <th className="px-4 py-2 text-right font-medium">Lipsă</th>
              <th className="px-4 py-2 text-right font-medium">Valoare</th>
            </tr>
          </thead>
          <tbody>
            {necesar.data.randuri.map((r) => (
              <tr key={r.codSaga} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{r.codSaga}</td>
                <td className="px-4 py-2">{r.denumire}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{r.gestiune ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                  {Number(r.necesar)} {r.um}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                  {r.stoc === null ? <span className="text-amber-700">necunoscut</span> : Number(r.stoc)}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">{Number(r.lipsa)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{lei(r.valoare)}</td>
              </tr>
            ))}
            {necesar.data.randuri.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-neutral-500">
                  Nimic de cumpărat: nu există bonuri calculate neexportate, sau stocul acoperă tot.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PanouCost({ utilizator }: { utilizator: UtilizatorCurent }) {
  const [deLa, setDeLa] = useState(ACUM_O_LUNA)
  const [panaLa, setPanaLa] = useState(AZI)

  const cost = useQuery({
    queryKey: ['cost', deLa, panaLa],
    queryFn: () => apel<Cost>(`/rapoarte/cost?deLa=${deLa}&panaLa=${panaLa}`),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">De la</span>
          <input
            type="date"
            value={deLa}
            onChange={(e) => setDeLa(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-neutral-600">Până la</span>
          <input
            type="date"
            value={panaLa}
            onChange={(e) => setPanaLa(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <span className="pb-2 text-sm text-neutral-500">
          bonuri exportate, {utilizator.rol === 'contabil' ? 'pentru contabilitate' : ''}
        </span>
      </div>

      {cost.data !== undefined && (
        <>
          <div className="flex flex-wrap gap-4">
            <Cifra eticheta="Cost material total" valoare={cost.data.total} accent />
            <Cifra eticheta="din care pierderi" valoare={cost.data.totalPierderi} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 text-right font-medium">Bonuri</th>
                  <th className="px-4 py-2 text-right font-medium">Bucăți</th>
                  <th className="px-4 py-2 text-right font-medium">Net</th>
                  <th className="px-4 py-2 text-right font-medium">Pierderi</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Pe bucată</th>
                  <th className="px-4 py-2 text-right font-medium">Acoperire</th>
                </tr>
              </thead>
              <tbody>
                {cost.data.randuri.map((r) => (
                  <tr key={r.model} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-2">
                      {r.denumire}
                      <span className="ml-2 text-xs text-neutral-400">{r.model}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.bonuri}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.bucati}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                      {lei(r.costNet)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                      {lei(r.costPierderi)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {lei(r.costTotal)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{lei(r.costPeBucata)}</td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={
                          r.acoperire >= 80
                            ? 'text-xs text-neutral-500'
                            : 'text-xs font-medium text-amber-700'
                        }
                      >
                        {r.acoperire}%
                      </span>
                    </td>
                  </tr>
                ))}
                {cost.data.randuri.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-neutral-500">
                      Niciun bon exportat în perioada aleasă.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Cifra({
  eticheta,
  valoare,
  accent,
}: {
  eticheta: string
  valoare: string | null
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <p className="text-xs text-neutral-500">{eticheta}</p>
      <p
        className={
          accent === true
            ? 'mt-1 text-xl font-semibold tabular-nums text-neutral-900'
            : 'mt-1 text-xl tabular-nums text-neutral-700'
        }
      >
        {lei(valoare)} <span className="text-sm font-normal text-neutral-400">lei</span>
      </p>
    </div>
  )
}
