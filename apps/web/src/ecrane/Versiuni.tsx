import type { RandVersiune, SchimbareLinie, UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { apel } from '../lib/api.js'
import { useNotificari } from '../ui/Notificari.js'
import { Insigna, mesajEroare } from '../ui/stari.js'

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

function felStatus(status: string): 'succes' | 'atentie' | 'neutru' | 'info' {
  if (status === 'activa') return 'succes'
  if (status === 'in_aprobare') return 'atentie'
  if (status === 'arhivata') return 'neutru'
  return 'info'
}

const ETICHETE_CAMP: Record<string, string> = {
  codSaga: 'cod',
  um: 'UM',
  modCalcul: 'mod',
  cantitateFixa: 'cantitate',
  formula: 'formulă',
  procentPierderi: 'pierderi',
}

const ETICHETE_FEL: Record<string, string> = {
  adaugat: 'adăugată',
  sters: 'ștearsă',
  modificat: 'modificată',
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
  areModificari,
  onSchimbaVersiune,
}: {
  modelId: string
  versiuneCurenta: string | null
  utilizator: UtilizatorCurent
  /** Unsaved lines in the grid: several actions here would send the wrong thing. */
  areModificari: boolean
  onSchimbaVersiune: (id: string | null) => void
}) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [compara, setCompara] = useState<string | null>(null)
  const [motivRespingere, setMotivRespingere] = useState('')
  const [aratRespingere, setAratRespingere] = useState(false)
  const [confirmaAprobare, setConfirmaAprobare] = useState(false)

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

  const activa = versiuni.data?.find((v) => v.status === 'activa')

  async function reincarca() {
    await queryClient.invalidateQueries({ queryKey: ['versiuni', modelId] })
    await queryClient.invalidateQueries({ queryKey: ['reteta', modelId] })
  }

  const actiune = useMutation({
    mutationFn: (v: { cale: string; corp?: unknown; mesaj: string }) =>
      apel(v.cale, { metoda: 'POST', ...(v.corp === undefined ? {} : { corp: v.corp }) }),
    onSuccess: async (_r, v) => {
      setAratRespingere(false)
      setConfirmaAprobare(false)
      setMotivRespingere('')
      notificari.succes(v.mesaj)
      await reincarca()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const versiuneNoua = useMutation({
    mutationFn: () => apel<{ id: string }>(`/modele/${modelId}/versiuni`, { metoda: 'POST' }),
    onSuccess: async (noua) => {
      notificari.succes('Versiune nouă creată. Rețeta activă a rămas neatinsă.')
      onSchimbaVersiune(noua.id)
      await reincarca()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  // What the approval would actually change, shown before it is irreversible.
  const comparaCu = confirmaAprobare && activa !== undefined ? activa.id : compara

  const comparatie = useQuery({
    queryKey: ['comparatie', curenta?.id, comparaCu],
    queryFn: () => apel<Comparatie>(`/retete/${curenta?.id ?? ''}/comparatie/${comparaCu ?? ''}`),
    enabled: curenta !== undefined && comparaCu !== null && comparaCu !== curenta?.id,
  })

  if (versiuni.isLoading || curenta === undefined) return null

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ink">Versiuni</span>

        <select
          value={curenta.id}
          aria-label="Versiunea afișată"
          onChange={(e) => onSchimbaVersiune(e.target.value)}
          className="camp camp-mic w-72"
        >
          {versiuni.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.status === 'activa' ? '● ' : ''}v{v.versiune} ·{' '}
              {ETICHETE_STATUS[v.status] ?? v.status} · {v.nrLinii} linii
              {v.nrBonuri > 0 && ` · ${v.nrBonuri} bonuri`}
            </option>
          ))}
        </select>

        <Insigna fel={felStatus(curenta.status)}>
          {ETICHETE_STATUS[curenta.status] ?? curenta.status}
        </Insigna>

        {curenta.nrBonuri > 0 && (
          <span className="text-xs text-ink-muted">
            {curenta.nrBonuri} {curenta.nrBonuri === 1 ? 'bon emis' : 'bonuri emise'} pe această
            versiune
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {poateEdita && curenta.status === 'draft' && (
            <>
              {areModificari && (
                <span className="text-xs text-atentie">Salvează întâi modificările din grilă.</span>
              )}
              <button
                type="button"
                disabled={actiune.isPending || curenta.nrLinii === 0 || areModificari}
                onClick={() =>
                  actiune.mutate({
                    cale: `/retete/${curenta.id}/trimite-spre-aprobare`,
                    mesaj: `v${curenta.versiune} a fost trimisă spre aprobare.`,
                  })
                }
                className="buton buton-primar buton-mic"
              >
                Trimite spre aprobare
              </button>
            </>
          )}

          {poateEdita && curenta.status === 'in_aprobare' && (
            <button
              type="button"
              disabled={actiune.isPending}
              onClick={() =>
                actiune.mutate({
                  cale: `/retete/${curenta.id}/retragere`,
                  mesaj: `v${curenta.versiune} a fost retrasă din aprobare.`,
                })
              }
              className="buton buton-secundar buton-mic"
            >
              Retrage
            </button>
          )}

          {esteAdmin && curenta.status === 'in_aprobare' && !confirmaAprobare && (
            <>
              <button
                type="button"
                onClick={() => setConfirmaAprobare(true)}
                className="buton buton-primar buton-mic"
              >
                Aprobă
              </button>
              <button
                type="button"
                onClick={() => setAratRespingere((a) => !a)}
                className="buton buton-secundar buton-mic"
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
              className="buton buton-primar buton-mic"
            >
              {versiuneNoua.isPending ? 'Se creează…' : 'Versiune nouă'}
            </button>
          )}
        </div>
      </div>

      {curenta.motivRespingere !== null && curenta.status === 'draft' && (
        <div className="rounded-lg border border-atentie-border bg-atentie-bg px-3 py-2 text-sm">
          <p className="font-medium text-atentie">
            Respinsă
            {curenta.respinsLa === null
              ? ''
              : ` la ${new Date(curenta.respinsLa).toLocaleDateString('ro-RO')}`}
          </p>
          <p className="mt-0.5 text-ink-secondary">„{curenta.motivRespingere}"</p>
        </div>
      )}

      {confirmaAprobare && (
        <div className="rounded-lg border border-brand-border bg-brand-subtle p-3">
          <p className="text-sm font-medium text-ink">
            v{curenta.versiune} devine activă
            {activa === undefined ? '.' : `, iar v${activa.versiune} se arhivează.`}
          </p>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Bonurile se vor emite pe ea. Rețetele active nu se mai modifică.
          </p>
          {comparatie.data !== undefined && (
            <p className="mt-1 text-sm text-ink-secondary">
              Față de v{activa?.versiune}: {comparatie.data.rezumat.adaugate} adăugate,{' '}
              {comparatie.data.rezumat.sterse} șterse, {comparatie.data.rezumat.modificate}{' '}
              modificate.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actiune.isPending}
              onClick={() =>
                actiune.mutate({
                  cale: `/retete/${curenta.id}/aprobare`,
                  mesaj: `v${curenta.versiune} este acum activă.`,
                })
              }
              className="buton buton-primar buton-mic"
            >
              Confirmă aprobarea
            </button>
            <button
              type="button"
              onClick={() => setConfirmaAprobare(false)}
              className="buton buton-discret buton-mic"
            >
              Renunță
            </button>
          </div>
        </div>
      )}

      {aratRespingere && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-sunken p-3">
          <input
            value={motivRespingere}
            onChange={(e) => setMotivRespingere(e.target.value)}
            placeholder="De ce o respingi? Tehnologul vede exact acest text."
            className="camp camp-mic w-96"
          />
          <button
            type="button"
            disabled={motivRespingere.trim().length < 5 || actiune.isPending}
            onClick={() =>
              actiune.mutate({
                cale: `/retete/${curenta.id}/respingere`,
                corp: { motiv: motivRespingere },
                mesaj: `v${curenta.versiune} a fost respinsă. Tehnologul vede motivul.`,
              })
            }
            className="buton buton-pericol-plin buton-mic"
          >
            Trimite respingerea
          </button>
        </div>
      )}

      {curenta.status === 'activa' && (
        <p className="text-xs text-ink-muted">
          Aprobată{' '}
          {curenta.aprobatLa === null
            ? ''
            : new Date(curenta.aprobatLa).toLocaleDateString('ro-RO')}
          {curenta.valabilDeLa !== null && `, valabilă de la ${curenta.valabilDeLa}`}. Nu se mai
          modifică — orice schimbare înseamnă o versiune nouă.
        </p>
      )}

      {(versiuni.data?.length ?? 0) > 1 && !confirmaAprobare && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-xs text-ink-muted">Compară v{curenta.versiune} cu</span>
          <select
            value={compara ?? ''}
            aria-label="Versiunea de comparat"
            onChange={(e) => setCompara(e.target.value === '' ? null : e.target.value)}
            className="camp camp-mic w-56"
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

      {comparatie.data !== undefined && !confirmaAprobare && (
        <TabelComparatie comparatie={comparatie.data} />
      )}
    </div>
  )
}

function TabelComparatie({ comparatie }: { comparatie: Comparatie }) {
  const schimbate = comparatie.schimbari.filter((s) => s.fel !== 'neschimbat')

  return (
    <div className="rounded-lg border border-line">
      <div className="flex flex-wrap gap-4 border-b border-line bg-surface-sunken px-3 py-2 text-xs">
        <span className="text-succes">{comparatie.rezumat.adaugate} adăugate</span>
        <span className="text-danger">{comparatie.rezumat.sterse} șterse</span>
        <span className="text-atentie">{comparatie.rezumat.modificate} modificate</span>
        <span className="text-ink-muted">{comparatie.rezumat.neschimbate} neschimbate</span>
      </div>

      {schimbate.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-muted">Versiunile sunt identice linie cu linie.</p>
      ) : (
        <ul className="divide-y divide-line">
          {schimbate.map((s) => (
            <li key={s.nrLinie} className="px-3 py-2 text-sm">
              <span className="mr-2">
                <Insigna
                  fel={s.fel === 'adaugat' ? 'succes' : s.fel === 'sters' ? 'pericol' : 'atentie'}
                >
                  {ETICHETE_FEL[s.fel] ?? s.fel}
                </Insigna>
              </span>
              <span className="text-ink-muted">linia {s.nrLinie}</span>{' '}
              <span className="font-mono text-xs">{s.codSaga ?? '—'}</span>{' '}
              <span className="text-ink-secondary">{s.denumire ?? ''}</span>

              {s.campuri.length > 0 && (
                <ul className="mt-1 ml-6 space-y-0.5 text-xs text-ink-secondary">
                  {s.campuri.map((c) => (
                    <li key={c.camp}>
                      {ETICHETE_CAMP[c.camp] ?? c.camp}:{' '}
                      <span className="text-danger line-through">{c.inainte ?? '—'}</span> →{' '}
                      <span className="font-medium text-succes">{c.dupa ?? '—'}</span>
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
