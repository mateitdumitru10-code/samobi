import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { apel } from '../lib/api.js'
import { CautaArticol, type ArticolGasit } from '../ui/CautaArticol.js'
import { cant, dataRo, lei } from '../ui/numere.js'
import { BannerEroare, Gol, Insigna, RanduriSchelet, RandStare } from '../ui/stari.js'

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
  acoperire: { linii: number; faraPret: number; umNepotrivita: number; procent: number }
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

const RAPOARTE = [
  { cheie: 'antecalculatie', eticheta: 'Antecalculație' },
  { cheie: 'necesar', eticheta: 'Necesar de aprovizionare' },
  { cheie: 'cost', eticheta: 'Cost material' },
] as const

type CheieRaport = (typeof RAPOARTE)[number]['cheie']

const AZI = new Date().toISOString().slice(0, 10)
const ACUM_O_LUNA = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)

export function Rapoarte({ utilizator }: { utilizator: UtilizatorCurent }) {
  // Kept in the URL so a refresh, a back button or a pasted link all land on
  // the report the user was actually looking at.
  const [raport, setRaport] = useState<CheieRaport>(() => {
    const din = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tip')
    return RAPOARTE.some((r) => r.cheie === din) ? (din as CheieRaport) : 'antecalculatie'
  })

  function alege(cheie: CheieRaport) {
    setRaport(cheie)
    window.history.replaceState(null, '', `#/rapoarte?tip=${cheie}`)
  }

  return (
    <section className="space-y-6">
      {/* A segmented control, not a second row of tabs: the primary navigation
          already owns that shape, and two of them stacked read as peers. */}
      <div className="inline-flex rounded-lg bg-surface-sunken p-1">
        {RAPOARTE.map((r) => (
          <button
            key={r.cheie}
            type="button"
            onClick={() => alege(r.cheie)}
            className={
              raport === r.cheie
                ? 'rounded-md bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-[0_1px_2px_rgb(28_25_23/0.06)]'
                : 'rounded-md px-3 py-1.5 text-sm text-ink-muted hover:text-ink'
            }
          >
            {r.eticheta}
          </button>
        ))}
      </div>

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
    <p className="rounded-lg border border-atentie-border bg-atentie-bg px-3 py-2 text-sm text-atentie">
      Doar <strong>{procent}%</strong> din linii intră în total. {detaliu} Restul lipsesc — cifra de
      mai jos e un minim, nu costul real.
    </p>
  )
}

function PanouAntecalculatie() {
  const [modelId, setModelId] = useState('')
  const [dimensiuneId, setDimensiuneId] = useState('')
  const [cantitate, setCantitate] = useState('1')
  const [alegeri, setAlegeri] = useState<Record<string, ArticolGasit>>({})

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
        corp: {
          modelId,
          dimensiuneId,
          cantitate,
          alegeri: Object.fromEntries(
            Object.entries(alegeri).map(([cheie, a]) => [cheie, a.codSaga]),
          ),
        },
      }),
  })

  const variabile = context.data?.liniiVariabile ?? []
  const cantitateValida = /^\d+$/.test(cantitate.trim()) && Number(cantitate) > 0
  const lipsescCoduri = variabile.filter((l) => alegeri[l.id] === undefined)
  const gata = modelId !== '' && dimensiuneId !== '' && lipsescCoduri.length === 0 && cantitateValida

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="model-ante" className="eticheta">
            Model
          </label>
          <select
            id="model-ante"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="camp w-64"
          >
            <option value="">{modele.isLoading ? 'se încarcă…' : 'alege…'}</option>
            {modele.data?.map((m) => (
              <option key={m.id} value={m.id} disabled={m.nrDimensiuni === 0}>
                {m.denumire}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="dim-ante" className="eticheta">
            Dimensiune
          </label>
          <select
            id="dim-ante"
            value={dimensiuneId}
            disabled={modelId === ''}
            onChange={(e) => setDimensiuneId(e.target.value)}
            className="camp w-40"
          >
            <option value="">{context.isFetching ? 'se încarcă…' : 'alege…'}</option>
            {context.data?.dimensiuni.map((d) => (
              <option key={d.id} value={d.id}>
                {d.cod}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cant-ante" className="eticheta">
            Cantitate (buc)
          </label>
          <input
            id="cant-ante"
            value={cantitate}
            inputMode="numeric"
            aria-invalid={cantitate.trim() !== '' && !cantitateValida}
            onChange={(e) => setCantitate(e.target.value)}
            className="camp w-24 text-right tabular-nums"
          />
        </div>

        <button
          type="button"
          disabled={!gata || calculeaza.isPending}
          onClick={() => calculeaza.mutate()}
          className="buton buton-primar"
        >
          {calculeaza.isPending ? 'Se calculează…' : 'Calculează'}
        </button>
      </div>

      {variabile.length > 0 && (
        <div className="rounded-lg border border-info-border bg-info-bg p-4">
          <h3 className="text-sm font-semibold text-info">Materiale variabile de ales</h3>
          <ul className="mt-3 space-y-2">
            {variabile.map((l) => {
              const ales = alegeri[l.id]
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-52 shrink-0 text-ink-secondary">
                    {l.grup}, {l.um} — linia {l.nrLinie}
                  </span>
                  {ales === undefined ? (
                    <CautaArticol
                      umAsteptat={l.um}
                      placeholder={
                        l.categorieVariabila === null
                          ? 'caută material…'
                          : `caută în ${l.categorieVariabila}…`
                      }
                      onAlege={(a) => setAlegeri((curente) => ({ ...curente, [l.id]: a }))}
                    />
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">{ales.codSaga}</span>
                      <span className="text-ink">{ales.denumire}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAlegeri((curente) =>
                            Object.fromEntries(
                              Object.entries(curente).filter(([cheie]) => cheie !== l.id),
                            ),
                          )
                        }
                        className="text-xs text-brand underline underline-offset-2"
                      >
                        schimbă
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {calculeaza.isError && <BannerEroare eroare={calculeaza.error} titlu="Calculul a eșuat." />}

      {calculeaza.data === undefined && !calculeaza.isPending && (
        <Gol
          titlu="Alege modelul și dimensiunea, apoi apasă Calculează"
          indiciu={
            lipsescCoduri.length > 0
              ? `Mai trebuie ales materialul pentru ${lipsescCoduri.length} linii variabile.`
              : 'Raportul arată ce costă un lot înainte să fie produs.'
          }
        />
      )}

      {calculeaza.data !== undefined && (
        <>
          <Acoperire
            procent={calculeaza.data.acoperire.procent}
            detaliu={
              `${calculeaza.data.acoperire.faraPret} din ${calculeaza.data.acoperire.linii} materiale n-au preț` +
              (calculeaza.data.acoperire.umNepotrivita > 0
                ? `, iar ${calculeaza.data.acoperire.umNepotrivita} au prețul în altă unitate decât cantitatea din rețetă — nu se pot înmulți.`
                : '.')
            }
          />

          <div className="flex flex-wrap gap-4">
            <Cifra eticheta="Material net" valoare={calculeaza.data.total.net} />
            <Cifra eticheta="Pierderi din croială" valoare={calculeaza.data.total.pierderi} />
            <Cifra eticheta="Total" valoare={calculeaza.data.total.total} accent />
            <Cifra eticheta="Pe bucată" valoare={calculeaza.data.total.peBucata} accent />
          </div>

          <div className="flex flex-wrap gap-2">
            {calculeaza.data.peGrup.map((g) => (
              <span key={g.grup} className="rounded-md bg-surface-sunken px-3 py-1.5 text-sm">
                {g.grup}{' '}
                <span className="font-medium tabular-nums">{lei(g.valoare)}</span>{' '}
                <span className="text-xs text-ink-muted">lei</span>
              </span>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm" aria-label="Antecalculație pe materiale">
              <thead className="bg-surface-sunken text-left text-xs uppercase text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Cod
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Denumire
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Grup
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Net
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Brut
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Preț (lei)
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Valoare (lei)
                  </th>
                </tr>
              </thead>
              <tbody>
                {calculeaza.data.randuri.map((r) => (
                  <tr
                    key={r.codSaga}
                    className={
                      r.pretUnitar === null
                        ? 'border-t border-line bg-atentie-bg'
                        : 'border-t border-line hover:bg-surface-page'
                    }
                  >
                    <td className="px-4 py-2 font-mono text-xs">{r.codSaga}</td>
                    <td className="px-4 py-2">{r.denumire}</td>
                    <td className="px-4 py-2 text-xs text-ink-muted">{r.grup ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                      {cant(r.cantitateNeta)} {r.um}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {cant(r.cantitateBruta)} {r.um}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                      {r.pretUnitar === null ? (
                        <span className="text-atentie">fără preț</span>
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

  const nrColoane = 7

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Materialele cerute de bonurile calculate și neexportate încă, minus stocul.
        {necesar.data?.stocLa != null &&
          ` Stocul e cel din importul de nomenclator din ${dataRo(necesar.data.stocLa)}.`}
      </p>

      {necesar.isError && (
        <BannerEroare
          eroare={necesar.error}
          titlu="Raportul nu s-a putut încărca."
          onReincearca={() => void necesar.refetch()}
        />
      )}

      {necesar.data !== undefined &&
        (necesar.data.faraStoc > 0 || necesar.data.faraPret > 0) && (
          <p className="rounded-lg border border-atentie-border bg-atentie-bg px-3 py-2 text-sm text-atentie">
            {necesar.data.faraStoc} materiale n-au stoc cunoscut (cerute integral),{' '}
            {necesar.data.faraPret} n-au preț.
          </p>
        )}

      <Cifra eticheta="De cumpărat" valoare={necesar.data?.total ?? null} accent />

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="Necesar de aprovizionare">
          <thead className="bg-surface-sunken text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Cod
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Denumire
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Gestiune
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Necesar
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Stoc
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Lipsă
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Valoare (lei)
              </th>
            </tr>
          </thead>
          <tbody>
            {necesar.isLoading && <RanduriSchelet coloane={nrColoane} />}

            {necesar.data?.randuri.map((r) => (
              <tr key={r.codSaga} className="border-t border-line hover:bg-surface-page">
                <td className="px-4 py-2 font-mono text-xs">{r.codSaga}</td>
                <td className="px-4 py-2">{r.denumire}</td>
                <td className="px-4 py-2 text-xs text-ink-muted">{r.gestiune ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {cant(r.necesar)} {r.um}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {r.stoc === null ? <span className="text-atentie">necunoscut</span> : cant(r.stoc)}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">{cant(r.lipsa)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{lei(r.valoare)}</td>
              </tr>
            ))}

            {necesar.data?.randuri.length === 0 && (
              <RandStare coloane={nrColoane}>
                <Gol
                  titlu="Nimic de cumpărat"
                  indiciu="Nu există bonuri calculate neexportate, sau stocul acoperă tot."
                />
              </RandStare>
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

  const intervalInvers = deLa > panaLa

  const cost = useQuery({
    queryKey: ['cost', deLa, panaLa],
    queryFn: () => apel<Cost>(`/rapoarte/cost?deLa=${deLa}&panaLa=${panaLa}`),
    enabled: !intervalInvers,
  })

  const nrColoane = 8

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="de-la" className="eticheta">
            De la
          </label>
          <input
            id="de-la"
            type="date"
            value={deLa}
            onChange={(e) => setDeLa(e.target.value)}
            aria-invalid={intervalInvers}
            className="camp"
          />
        </div>
        <div>
          <label htmlFor="pana-la" className="eticheta">
            Până la
          </label>
          <input
            id="pana-la"
            type="date"
            value={panaLa}
            onChange={(e) => setPanaLa(e.target.value)}
            aria-invalid={intervalInvers}
            className="camp"
          />
        </div>
        <p className="pb-2.5 text-sm text-ink-muted">
          Costuri din bonurile exportate în perioada aleasă
          {utilizator.rol === 'contabil' ? ', pentru contabilitate' : ''}.
        </p>
      </div>

      {intervalInvers && (
        <p
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger"
        >
          Data de început este după data de sfârșit.
        </p>
      )}

      {cost.isError && (
        <BannerEroare
          eroare={cost.error}
          titlu="Raportul nu s-a putut încărca."
          onReincearca={() => void cost.refetch()}
        />
      )}

      <div className="flex flex-wrap gap-4">
        <Cifra eticheta="Cost material total" valoare={cost.data?.total ?? null} accent />
        <Cifra eticheta="din care pierderi" valoare={cost.data?.totalPierderi ?? null} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="Cost material pe model">
          <thead className="bg-surface-sunken text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Model
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Bonuri
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Bucăți
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Net (lei)
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Pierderi (lei)
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Total (lei)
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Pe bucată (lei)
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                <abbr title="Procentul liniilor de rețetă care au preț și intră în total">
                  Acoperire
                </abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {cost.isLoading && !intervalInvers && <RanduriSchelet coloane={nrColoane} />}

            {cost.data?.randuri.map((r) => (
              <tr key={r.model} className="border-t border-line hover:bg-surface-page">
                <td className="px-4 py-2">
                  {r.denumire}
                  <span className="ml-2 text-xs text-ink-muted">{r.model}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.bonuri}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.bucati}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {lei(r.costNet)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {lei(r.costPierderi)}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">{lei(r.costTotal)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{lei(r.costPeBucata)}</td>
                <td className="px-4 py-2 text-right">
                  {r.acoperire >= 80 ? (
                    <span className="text-xs text-ink-muted">{r.acoperire}%</span>
                  ) : (
                    <Insigna fel="atentie">{r.acoperire}%</Insigna>
                  )}
                </td>
              </tr>
            ))}

            {cost.data?.randuri.length === 0 && (
              <RandStare coloane={nrColoane}>
                <Gol
                  titlu="Niciun bon exportat în perioada aleasă"
                  indiciu="Raportul numără doar bonurile plecate în SAGA."
                />
              </RandStare>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-muted">
        Acoperire = câte dintre materialele rețetei au preț. Sub 100%, costul afișat e un minim.
      </p>
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
    <div className="card px-4 py-3">
      <p className="text-xs text-ink-muted">{eticheta}</p>
      <p
        className={
          accent === true
            ? 'mt-1 text-2xl font-semibold tabular-nums text-ink'
            : 'mt-1 text-2xl tabular-nums text-ink-secondary'
        }
      >
        {lei(valoare)}
        {valoare !== null && <span className="ml-1 text-sm font-normal text-ink-muted">lei</span>}
      </p>
    </div>
  )
}
