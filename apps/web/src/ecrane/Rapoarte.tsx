import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { apel } from '../lib/api.js'
import { lei } from '../ui/numere.js'
import { BannerEroare, Gol, Insigna, RanduriSchelet, RandStare } from '../ui/stari.js'

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

const AZI = new Date().toISOString().slice(0, 10)
const ACUM_O_LUNA = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)

/**
 * What production cost over a period, per model.
 *
 * The one report that reads from what actually happened. The two that used to
 * sit beside it — a costing before the run, and what was left to buy — were
 * both predictions, and a prediction built on a catalogue that prices half the
 * materials is a number nobody could act on.
 */
export function Rapoarte({ utilizator }: { utilizator: { rol: string } }) {
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
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">Cost material</h2>

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
            className="camp w-40"
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
            className="camp w-40"
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
    </section>
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
