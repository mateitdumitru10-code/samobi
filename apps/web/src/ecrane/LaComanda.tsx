import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { apel } from '../lib/api.js'
import { CautaArticol } from '../ui/CautaArticol.js'
import { useNotificari } from '../ui/Notificari.js'
import { Insigna, mesajEroare } from '../ui/stari.js'

export interface ModelLaComanda {
  id: string
  lungimeMin: string | null
  lungimeMax: string | null
  latimeMin: string | null
  latimeMax: string | null
  inaltimeMin: string | null
  inaltimeMax: string | null
  codSagaProdusComanda: string | null
  denumireProdusComanda?: string | null
}

interface Avertisment {
  fel: 'formula' | 'tabel' | 'override' | 'cod-lipsa'
  nrLinie: number | null
  mesaj: string
}

const mm = (v: string | null): string => (v === null ? '' : String(Number(v)))

/**
 * Opening a model to sizes nobody registered.
 *
 * The range is the feature. A formula is a claim about an interval, not about a
 * point, and this is where the tehnolog states the interval and immediately
 * sees which lines stop making sense at its corners — before an operator meets
 * them with a customer waiting.
 */
export function LaComanda({ model, poateEdita }: { model: ModelLaComanda; poateEdita: boolean }) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()

  const activInitial = model.lungimeMin !== null
  const [deschis, setDeschis] = useState(activInitial)
  const [avertismente, setAvertismente] = useState<Avertisment[] | null>(null)

  const [lungimeMin, setLungimeMin] = useState(mm(model.lungimeMin))
  const [lungimeMax, setLungimeMax] = useState(mm(model.lungimeMax))
  const [latimeMin, setLatimeMin] = useState(mm(model.latimeMin))
  const [latimeMax, setLatimeMax] = useState(mm(model.latimeMax))
  const [inaltimeMin, setInaltimeMin] = useState(mm(model.inaltimeMin))
  const [inaltimeMax, setInaltimeMax] = useState(mm(model.inaltimeMax))
  const [produs, setProdus] = useState<{ codSaga: string; denumire: string } | null>(
    model.codSagaProdusComanda === null
      ? null
      : {
          codSaga: model.codSagaProdusComanda,
          denumire: model.denumireProdusComanda ?? '',
        },
  )

  const salveaza = useMutation({
    mutationFn: (activ: boolean) =>
      apel<{ avertismente: Avertisment[] }>(`/modele/${model.id}/la-comanda`, {
        metoda: 'PUT',
        corp: activ
          ? {
              lungimeMin: lungimeMin || null,
              lungimeMax: lungimeMax || null,
              latimeMin: latimeMin || null,
              latimeMax: latimeMax || null,
              inaltimeMin: inaltimeMin || null,
              inaltimeMax: inaltimeMax || null,
              codSagaProdusComanda: produs?.codSaga ?? null,
            }
          : {
              lungimeMin: null,
              lungimeMax: null,
              latimeMin: null,
              latimeMax: null,
              inaltimeMin: null,
              inaltimeMax: null,
              codSagaProdusComanda: null,
            },
      }),
    onSuccess: async (raspuns, activ) => {
      setAvertismente(activ ? raspuns.avertismente : null)
      notificari.succes(
        activ ? 'Modelul acceptă acum dimensiuni la comandă.' : 'Dimensiunile la comandă sunt oprite.',
      )
      await queryClient.invalidateQueries({ queryKey: ['model', model.id] })
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    salveaza.mutate(true)
  }

  if (!deschis) {
    return (
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Dimensiuni la comandă</h3>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Modelul se emite doar pe dimensiunile înregistrate mai sus. Activează dacă se poate
              produce și la dimensiunile cerute de client, în limitele pe care le stabilești.
            </p>
          </div>
          {poateEdita && (
            <button
              type="button"
              onClick={() => setDeschis(true)}
              className="buton buton-secundar buton-mic"
            >
              Activează dimensiunile la comandă
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={trimite} className="card space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            Dimensiuni la comandă
            {activInitial && <Insigna fel="info">activ</Insigna>}
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Interval acceptat, în milimetri. În afara lui, bonurile sunt refuzate — nu aproximate.
          </p>
        </div>
        {poateEdita && activInitial && (
          <button
            type="button"
            disabled={salveaza.isPending}
            onClick={() => {
              setDeschis(false)
              salveaza.mutate(false)
            }}
            className="buton buton-pericol buton-mic"
          >
            Dezactivează
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-6">
        <Axa
          eticheta="Lungime"
          min={lungimeMin}
          max={lungimeMax}
          setMin={setLungimeMin}
          setMax={setLungimeMax}
          dezactivat={!poateEdita}
        />
        <Axa
          eticheta="Lățime"
          min={latimeMin}
          max={latimeMax}
          setMin={setLatimeMin}
          setMax={setLatimeMax}
          dezactivat={!poateEdita}
        />
        <Axa
          eticheta="Înălțime"
          min={inaltimeMin}
          max={inaltimeMax}
          setMin={setInaltimeMin}
          setMax={setInaltimeMax}
          dezactivat={!poateEdita}
          optional
        />
      </div>

      <div>
        <span className="eticheta">Produs finit în SAGA pentru dimensiuni la comandă</span>
        {produs === null ? (
          <CautaArticol
            clasa="camp w-80"
            placeholder="caută articolul de predare…"
            onAlege={(a) => setProdus({ codSaga: a.codSaga, denumire: a.denumire })}
          />
        ) : (
          <span className="flex h-10 items-center gap-2 text-sm">
            <span className="font-mono text-xs">{produs.codSaga}</span>
            <span className="text-ink">{produs.denumire}</span>
            {poateEdita && (
              <button
                type="button"
                onClick={() => setProdus(null)}
                className="text-xs text-brand underline underline-offset-2"
              >
                schimbă
              </button>
            )}
          </span>
        )}
        <p className="indiciu">
          Toate bonurile la comandă ale modelului se predau pe acest cod. Dimensiunea reală rămâne
          pe bon, în aplicație.
        </p>
      </div>

      {poateEdita && (
        <button type="submit" disabled={salveaza.isPending} className="buton buton-primar">
          {salveaza.isPending ? 'Se salvează…' : 'Salvează intervalul'}
        </button>
      )}

      {avertismente !== null && <Avertismente lista={avertismente} />}
    </form>
  )
}

function Axa({
  eticheta,
  min,
  max,
  setMin,
  setMax,
  dezactivat,
  optional,
}: {
  eticheta: string
  min: string
  max: string
  setMin: (v: string) => void
  setMax: (v: string) => void
  dezactivat: boolean
  optional?: boolean
}) {
  return (
    <div>
      <span className="eticheta">
        {eticheta} (mm){optional === true && <span className="text-ink-disabled"> — opțional</span>}
      </span>
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        de la
        <input
          value={min}
          inputMode="numeric"
          disabled={dezactivat}
          onChange={(e) => setMin(e.target.value)}
          className="camp w-24 text-right tabular-nums"
          aria-label={`${eticheta} minimă`}
        />
        până la
        <input
          value={max}
          inputMode="numeric"
          disabled={dezactivat}
          onChange={(e) => setMax(e.target.value)}
          className="camp w-24 text-right tabular-nums"
          aria-label={`${eticheta} maximă`}
        />
      </div>
    </div>
  )
}

/**
 * What the recipe does at the corners of the range.
 *
 * Grouped by kind rather than listed flat: a formula that goes negative is a
 * bug, a `tabel` line is a question the operator will be asked, and an override
 * that stops applying is a silent change of behaviour. Three different things
 * to do about them.
 */
function Avertismente({ lista }: { lista: Avertisment[] }) {
  if (lista.length === 0) {
    return (
      <p className="rounded-lg border border-succes-border bg-succes-bg px-3 py-2 text-sm text-succes">
        Rețeta ține pe tot intervalul declarat.
      </p>
    )
  }

  const grupuri = [
    {
      fel: 'formula' as const,
      titlu: 'Formule care nu țin pe tot intervalul',
      ton: 'border-danger-border bg-danger-bg text-danger',
    },
    {
      fel: 'cod-lipsa' as const,
      titlu: 'Cod de predare',
      ton: 'border-atentie-border bg-atentie-bg text-atentie',
    },
    {
      fel: 'tabel' as const,
      titlu: 'Linii «tabel» — cantitatea se cere la fiecare bon',
      ton: 'border-atentie-border bg-atentie-bg text-atentie',
    },
    {
      fel: 'override' as const,
      titlu: 'Valori fixate manual — nu se aplică la comandă',
      ton: 'border-line bg-surface-sunken text-ink-secondary',
    },
  ]

  return (
    <div className="space-y-2">
      {grupuri.map((g) => {
        const ale = lista.filter((a) => a.fel === g.fel)
        if (ale.length === 0) return null
        return (
          <div key={g.fel} className={`rounded-lg border px-3 py-2 text-sm ${g.ton}`}>
            <p className="font-medium">
              {g.titlu} ({ale.length})
            </p>
            <ul className="mt-1 space-y-0.5">
              {ale.map((a, i) => (
                <li key={`${a.nrLinie}-${i}`}>
                  {a.nrLinie !== null && <span className="text-ink-muted">linia {a.nrLinie}: </span>}
                  {a.mesaj}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
