import type { RandVersiune, SchimbareLinie, UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { apel, EroareApi } from '../lib/api.js'

interface Comparatie {
  veche: { versiune: number; status: string }
  noua: { versiune: number; status: string }
  schimbari: SchimbareLinie[]
  rezumat: { adaugate: number; sterse: number; modificate: number; neschimbate: number }
}

const ETICHETE_STATUS: Record<string, string> = {
  draft: 'în lucru',
  in_aprobare: 'așteaptă aprobare',
  activa: 'activă',
  arhivata: 'arhivată',
}

function culoareStatus(status: string): string {
  if (status === 'activa') return 'bg-green-50 text-green-700'
  if (status === 'in_aprobare') return 'bg-amber-50 text-amber-800'
  if (status === 'arhivata') return 'bg-neutral-100 text-neutral-500'
  return 'bg-blue-50 text-blue-700'
}

const ETICHETE_CAMP: Record<string, string> = {
  codSaga: 'cod',
  um: 'UM',
  modCalcul: 'mod',
  cantitateFixa: 'cantitate',
  formula: 'formulă',
  procentPierderi: 'pierderi',
}

/**
 * The version panel above the recipe grid.
 *
 * A recipe is a version, not a fact: the sheets themselves prove it — CANAPEA
 * MARIA went from two rollers to four and back. This is where that history is
 * visible and where a change is signed off before any bon can be built on it.
 */
export function Versiuni({
  modelId,
  versiuneCurenta,
  utilizator,
  onSchimbaVersiune,
}: {
  modelId: string
  versiuneCurenta: string | null
  utilizator: UtilizatorCurent
  onSchimbaVersiune: (id: string | null) => void
}) {
  const queryClient = useQueryClient()
  const [compara, setCompara] = useState<string | null>(null)
  const [motivRespingere, setMotivRespingere] = useState('')
  const [aratRespingere, setAratRespingere] = useState(false)

  const esteAdmin = utilizator.rol === 'admin'
  const poateEdita = esteAdmin || utilizator.rol === 'tehnolog'

  const versiuni = useQuery({
    queryKey: ['versiuni', modelId],
    queryFn: () => apel<RandVersiune[]>(`/modele/${modelId}/versiuni`),
  })

  const curenta =
    versiuni.data?.find((v) => v.id === versiuneCurenta) ??
    versiuni.data?.find((v) => v.status === 'draft') ??
    versiuni.data?.find((v) => v.status === 'activa') ??
    versiuni.data?.[0]

  async function reincarca() {
    await queryClient.invalidateQueries({ queryKey: ['versiuni', modelId] })
    await queryClient.invalidateQueries({ queryKey: ['reteta', modelId] })
  }

  const actiune = useMutation({
    mutationFn: (v: { cale: string; corp?: unknown }) =>
      apel(v.cale, { metoda: 'POST', ...(v.corp === undefined ? {} : { corp: v.corp }) }),
    onSuccess: async () => {
      setAratRespingere(false)
      setMotivRespingere('')
      await reincarca()
    },
  })

  const versiuneNoua = useMutation({
    mutationFn: () => apel<{ id: string }>(`/modele/${modelId}/versiuni`, { metoda: 'POST' }),
    onSuccess: async (noua) => {
      onSchimbaVersiune(noua.id)
      await reincarca()
    },
  })

  const comparatie = useQuery({
    queryKey: ['comparatie', curenta?.id, compara],
    queryFn: () => apel<Comparatie>(`/retete/${curenta?.id ?? ''}/comparatie/${compara ?? ''}`),
    enabled: curenta !== undefined && compara !== null,
  })

  if (versiuni.isLoading || curenta === undefined) return null

  const eroare = [actiune.error, versiuneNoua.error].find((e): e is EroareApi => e instanceof EroareApi)

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-neutral-900">Versiuni</span>

        <select
          value={curenta.id}
          onChange={(e) => onSchimbaVersiune(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        >
          {versiuni.data?.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.versiune} · {ETICHETE_STATUS[v.status] ?? v.status} · {v.nrLinii} linii
              {v.nrBonuri > 0 && ` · ${v.nrBonuri} bonuri`}
            </option>
          ))}
        </select>

        <span className={`rounded-full px-2 py-1 text-xs ${culoareStatus(curenta.status)}`}>
          {ETICHETE_STATUS[curenta.status] ?? curenta.status}
        </span>

        {curenta.nrBonuri > 0 && (
          <span className="text-xs text-neutral-500">
            {curenta.nrBonuri} {curenta.nrBonuri === 1 ? 'bon emis' : 'bonuri emise'} pe această
            versiune
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {poateEdita && curenta.status === 'draft' && (
            <button
              type="button"
              disabled={actiune.isPending || curenta.nrLinii === 0}
              onClick={() =>
                actiune.mutate({ cale: `/retete/${curenta.id}/trimite-spre-aprobare` })
              }
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Trimite spre aprobare
            </button>
          )}

          {poateEdita && curenta.status === 'in_aprobare' && (
            <button
              type="button"
              disabled={actiune.isPending}
              onClick={() => actiune.mutate({ cale: `/retete/${curenta.id}/retragere` })}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Retrage
            </button>
          )}

          {esteAdmin && curenta.status === 'in_aprobare' && (
            <>
              <button
                type="button"
                disabled={actiune.isPending}
                onClick={() => actiune.mutate({ cale: `/retete/${curenta.id}/aprobare` })}
                className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Aprobă
              </button>
              <button
                type="button"
                onClick={() => setAratRespingere((a) => !a)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
              >
                Respinge
              </button>
            </>
          )}

          {poateEdita && (curenta.status === 'activa' || curenta.status === 'arhivata') && (
            <button
              type="button"
              disabled={versiuneNoua.isPending}
              onClick={() => versiuneNoua.mutate()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {versiuneNoua.isPending ? 'Se creează…' : 'Versiune nouă'}
            </button>
          )}
        </div>
      </div>

      {aratRespingere && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-3">
          <input
            value={motivRespingere}
            onChange={(e) => setMotivRespingere(e.target.value)}
            placeholder="De ce o respingi? Tehnologul trebuie să știe ce să corecteze."
            className="w-96 rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={motivRespingere.trim().length < 5 || actiune.isPending}
            onClick={() =>
              actiune.mutate({
                cale: `/retete/${curenta.id}/respingere`,
                corp: { motiv: motivRespingere },
              })
            }
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Trimite respingerea
          </button>
        </div>
      )}

      {eroare && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{eroare.message}</p>
      )}

      {curenta.status === 'activa' && (
        <p className="text-xs text-neutral-500">
          Aprobată {curenta.aprobatLa === null ? '' : new Date(curenta.aprobatLa).toLocaleDateString('ro-RO')}
          {curenta.valabilDeLa !== null && `, valabilă de la ${curenta.valabilDeLa}`}. Nu se mai
          modifică — orice schimbare înseamnă o versiune nouă.
        </p>
      )}

      {(versiuni.data?.length ?? 0) > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
          <span className="text-xs text-neutral-500">Compară v{curenta.versiune} cu</span>
          <select
            value={compara ?? ''}
            onChange={(e) => setCompara(e.target.value === '' ? null : e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">alege versiunea…</option>
            {versiuni.data
              ?.filter((v) => v.id !== curenta.id)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versiune} ({ETICHETE_STATUS[v.status] ?? v.status})
                </option>
              ))}
          </select>
        </div>
      )}

      {comparatie.data !== undefined && (
        <TabelComparatie comparatie={comparatie.data} />
      )}
    </div>
  )
}

function TabelComparatie({ comparatie }: { comparatie: Comparatie }) {
  const schimbate = comparatie.schimbari.filter((s) => s.fel !== 'neschimbat')

  return (
    <div className="rounded-md border border-neutral-200">
      <div className="flex flex-wrap gap-4 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
        <span className="text-green-700">{comparatie.rezumat.adaugate} adăugate</span>
        <span className="text-red-700">{comparatie.rezumat.sterse} șterse</span>
        <span className="text-amber-700">{comparatie.rezumat.modificate} modificate</span>
        <span className="text-neutral-500">{comparatie.rezumat.neschimbate} neschimbate</span>
      </div>

      {schimbate.length === 0 ? (
        <p className="px-3 py-4 text-sm text-neutral-500">
          Versiunile sunt identice linie cu linie.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {schimbate.map((s) => (
            <li key={s.nrLinie} className="px-3 py-2 text-sm">
              <span
                className={
                  s.fel === 'adaugat'
                    ? 'mr-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800'
                    : s.fel === 'sters'
                      ? 'mr-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800'
                      : 'mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800'
                }
              >
                {s.fel}
              </span>
              <span className="text-neutral-400">linia {s.nrLinie}</span>{' '}
              <span className="font-mono text-xs">{s.codSaga ?? '—'}</span>{' '}
              <span className="text-neutral-700">{s.denumire ?? ''}</span>

              {s.campuri.length > 0 && (
                <ul className="ml-6 mt-1 space-y-0.5 text-xs text-neutral-600">
                  {s.campuri.map((c) => (
                    <li key={c.camp}>
                      {ETICHETE_CAMP[c.camp] ?? c.camp}:{' '}
                      <span className="text-red-700 line-through">{c.inainte ?? '—'}</span> →{' '}
                      <span className="font-medium text-green-700">{c.dupa ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
