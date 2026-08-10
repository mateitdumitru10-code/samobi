import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { apel } from '../lib/api.js'
import { cant } from '../ui/numere.js'
import { BannerEroare, Insigna, Schelet } from '../ui/stari.js'

interface Comparatie {
  coloane: { cod: string; laComanda: boolean }[]
  linii: {
    linieId: string
    nrLinie: number
    grup: string
    um: string
    modCalcul: string
    formula: string | null
    denumire: string | null
    valori: { cantitate: string | null; motiv: string | null }[]
  }[]
}

/**
 * The answer to „ce se schimbă când se schimbă dimensiunea".
 *
 * Every line, at every registered size, side by side — plus a trial size the
 * tehnolog types, so a formula can be pushed past the sizes on record before
 * anybody is asked to build one. A row that reads the same all the way across
 * is either genuinely size-independent or a constant nobody has converted yet,
 * and seeing the two kinds next to each other is what makes the difference
 * obvious.
 */
export function ComparatieDimensiuni({ modelId }: { modelId: string }) {
  const [deschis, setDeschis] = useState(false)
  const [lungime, setLungime] = useState('')
  const [latime, setLatime] = useState('')
  const [inaltime, setInaltime] = useState('')

  const probaValida = /^[1-9]\d{0,4}$/.test(lungime) && /^[1-9]\d{0,4}$/.test(latime)

  const comparatie = useQuery({
    queryKey: ['comparatie', modelId, probaValida ? `${lungime}x${latime}x${inaltime}` : ''],
    queryFn: () => {
      const parametri = new URLSearchParams()
      if (probaValida) {
        parametri.set('lungime', lungime)
        parametri.set('latime', latime)
        if (/^[1-9]\d{0,4}$/.test(inaltime)) parametri.set('inaltime', inaltime)
      }
      const query = parametri.toString()
      return apel<Comparatie>(`/modele/${modelId}/comparatie${query === '' ? '' : `?${query}`}`)
    },
    enabled: deschis,
  })

  if (!deschis) {
    return (
      <button
        type="button"
        onClick={() => setDeschis(true)}
        className="buton buton-secundar buton-mic"
      >
        Vezi cum se schimbă cantitățile cu dimensiunea
      </button>
    )
  }

  const date = comparatie.data
  const constante =
    date === undefined
      ? 0
      : date.linii.filter((l) => {
          const valori = l.valori.map((v) => v.cantitate)
          return valori.length > 1 && new Set(valori).size === 1
        }).length

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Cantitățile pe dimensiuni</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Ce consumă fiecare linie, pentru o bucată, la fiecare dimensiune.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDeschis(false)}
          className="buton buton-discret buton-mic"
        >
          Închide
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <span className="text-sm text-ink-secondary">Adaugă o dimensiune de probă (mm):</span>
        <input
          value={lungime}
          inputMode="numeric"
          placeholder="L"
          aria-label="Lungime de probă"
          onChange={(e) => setLungime(e.target.value)}
          className="camp camp-mic w-20 text-right tabular-nums"
        />
        <input
          value={latime}
          inputMode="numeric"
          placeholder="l"
          aria-label="Lățime de probă"
          onChange={(e) => setLatime(e.target.value)}
          className="camp camp-mic w-20 text-right tabular-nums"
        />
        <input
          value={inaltime}
          inputMode="numeric"
          placeholder="H"
          aria-label="Înălțime de probă"
          onChange={(e) => setInaltime(e.target.value)}
          className="camp camp-mic w-20 text-right tabular-nums"
        />
      </div>

      {comparatie.isLoading && <Schelet className="h-40 w-full" />}
      {comparatie.isError && (
        <BannerEroare eroare={comparatie.error} onReincearca={() => void comparatie.refetch()} />
      )}

      {date !== undefined && (
        <>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-line">
            <table className="w-full text-sm" aria-label="Cantități pe dimensiuni">
              <thead className="sticky top-0 z-10 bg-surface-sunken text-left text-xs uppercase text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Material
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    UM
                  </th>
                  {date.coloane.map((c) => (
                    <th key={c.cod} scope="col" className="px-3 py-2 text-right font-medium">
                      {c.cod}
                      {c.laComanda && <span className="ml-1 text-brand">probă</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {date.linii.map((linie) => {
                  const valori = linie.valori.map((v) => v.cantitate)
                  const constanta = valori.length > 1 && new Set(valori).size === 1
                  return (
                    <tr key={linie.linieId} className="border-t border-line hover:bg-surface-page">
                      <td className="px-3 py-1.5 text-ink-disabled tabular-nums">{linie.nrLinie}</td>
                      <td className="px-3 py-1.5">
                        {linie.denumire ?? '—'}
                        {linie.formula !== null && (
                          <code className="ml-2 rounded bg-surface-sunken px-1 py-0.5 text-[11px] text-ink-muted">
                            {linie.formula}
                          </code>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted">{linie.um}</td>
                      {linie.valori.map((v, i) => (
                        <td
                          key={i}
                          className={`px-3 py-1.5 text-right tabular-nums ${
                            constanta ? 'text-ink-muted' : 'font-medium text-ink'
                          }`}
                        >
                          {v.cantitate !== null ? (
                            cant(v.cantitate)
                          ) : (
                            <span className="text-atentie" title={v.motiv ?? undefined}>
                              —
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {date.coloane.length > 1 && (
            <p className="text-sm text-ink-secondary">
              {constante === date.linii.length ? (
                <>
                  <Insigna fel="atentie">nimic nu variază</Insigna> Toate cele {date.linii.length}{' '}
                  linii dau același număr la orice dimensiune — rețeta e scrisă numai din
                  constante. Trece pe formulă liniile care chiar depind de mărime.
                </>
              ) : (
                <>
                  {date.linii.length - constante} linii se schimbă cu dimensiunea, {constante} nu.
                  Cele care nu se schimbă sunt fie corect constante (picioare, șuruburi), fie încă
                  netrecute pe formulă.
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}
