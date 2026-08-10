import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * One place for „salvat", „exportat", „a eșuat".
 *
 * Before this, every screen invented its own inline paragraph, and several of
 * them stayed on screen forever — a success from ten minutes ago sitting next
 * to a fresh error. Successes fade; errors wait to be dismissed, because an
 * error the user did not see is an error they will repeat.
 *
 * An action that can be taken back carries its own undo here rather than a
 * confirmation dialog in front of it. At a hundred decisions in a row, a
 * confirmation is pure friction; an undo costs nothing until it is needed.
 */

export interface Actiune {
  eticheta: string
  executa: () => void
}

interface Notificare {
  id: number
  tip: 'succes' | 'eroare' | 'info'
  mesaj: string
  actiune?: Actiune
}

interface Context {
  notifica: (n: Omit<Notificare, 'id'>) => void
  succes: (mesaj: string, actiune?: Actiune) => void
  eroare: (mesaj: string) => void
}

const ContextNotificari = createContext<Context | null>(null)

export function useNotificari(): Context {
  const context = useContext(ContextNotificari)
  if (context === null) throw new Error('useNotificari în afara <Notificari>')
  return context
}

const DURATA_SUCCES = 5000

export function Notificari({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Notificare[]>([])
  const urmatorulId = useRef(1)

  const inchide = useCallback((id: number) => {
    setLista((curente) => curente.filter((n) => n.id !== id))
  }, [])

  const notifica = useCallback(
    (n: Omit<Notificare, 'id'>) => {
      const id = urmatorulId.current
      urmatorulId.current += 1
      setLista((curente) => [...curente, { ...n, id }])
      if (n.tip !== 'eroare') {
        setTimeout(() => inchide(id), DURATA_SUCCES)
      }
    },
    [inchide],
  )

  const valoare = useMemo<Context>(
    () => ({
      notifica,
      succes: (mesaj, actiune) =>
        notifica(actiune === undefined ? { tip: 'succes', mesaj } : { tip: 'succes', mesaj, actiune }),
      eroare: (mesaj) => notifica({ tip: 'eroare', mesaj }),
    }),
    [notifica],
  )

  return (
    <ContextNotificari.Provider value={valoare}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:w-96"
      >
        {lista.map((n) => (
          <Cartonas key={n.id} notificare={n} onInchide={() => inchide(n.id)} />
        ))}
      </div>
    </ContextNotificari.Provider>
  )
}

function Cartonas({
  notificare,
  onInchide,
}: {
  notificare: Notificare
  onInchide: () => void
}) {
  const culoare =
    notificare.tip === 'eroare'
      ? 'border-l-danger'
      : notificare.tip === 'succes'
        ? 'border-l-succes'
        : 'border-l-info'

  return (
    <div
      className={`pointer-events-auto w-full rounded-lg border border-line border-l-4 bg-surface px-4 py-3 shadow-[0_8px_24px_rgb(28_25_23/0.12)] ${culoare}`}
    >
      <div className="flex items-start gap-3">
        <Pictograma tip={notificare.tip} />
        <p className="flex-1 text-sm text-ink">
          {notificare.tip === 'eroare' && <span className="font-medium">Eroare: </span>}
          {notificare.mesaj}
        </p>
        <button
          type="button"
          onClick={onInchide}
          aria-label="Închide"
          className="-m-2 p-2 text-ink-muted hover:text-ink"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {notificare.actiune !== undefined && (
        <button
          type="button"
          onClick={() => {
            notificare.actiune?.executa()
            onInchide()
          }}
          className="mt-2 ml-7 text-sm font-medium text-brand underline underline-offset-2"
        >
          {notificare.actiune.eticheta}
        </button>
      )}
    </div>
  )
}

/** Never hue alone: the shape says what the colour says. */
function Pictograma({ tip }: { tip: Notificare['tip'] }) {
  if (tip === 'succes') {
    return (
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-succes" aria-hidden="true">
        <path
          d="M4 10.5l4 4 8-9"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (tip === 'eroare') {
    return (
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth={2} />
        <path d="M10 6v5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="1.1" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M10 9v5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <circle cx="10" cy="6" r="1.1" fill="currentColor" />
    </svg>
  )
}
