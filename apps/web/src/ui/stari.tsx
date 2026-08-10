import { useEffect, useState, type ReactNode } from 'react'

import { EroareApi } from '../lib/api.js'

import { SiglaCanapea } from './Sigla.js'

/** Whatever the throw was, a sentence a person can read. */
export function mesajEroare(eroare: unknown, implicit = 'Ceva nu a mers.'): string {
  if (eroare instanceof EroareApi) return eroare.message
  if (eroare instanceof TypeError) return 'Nu s-a putut contacta serverul. Verifică rețeaua.'
  if (eroare instanceof Error && eroare.message !== '') return eroare.message
  return implicit
}

export function Schelet({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-sunken ${className}`} />
}

/**
 * Nothing here — and which kind of nothing.
 *
 * An empty table body is the same pixels whether the request is in flight, has
 * failed, or genuinely returned nothing; three states a user has to tell apart.
 */
export function Gol({
  titlu,
  indiciu,
  children,
}: {
  titlu: string
  indiciu?: string | undefined
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <SiglaCanapea className="h-8 w-8 text-line-strong" />
      <p className="mt-3 text-sm font-medium text-ink-secondary">{titlu}</p>
      {indiciu !== undefined && (
        <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{indiciu}</p>
      )}
      {children !== undefined && <div className="mt-4">{children}</div>}
    </div>
  )
}

export function BannerEroare({
  eroare,
  onReincearca,
  titlu = 'Nu s-a putut încărca.',
}: {
  eroare: unknown
  onReincearca?: () => void
  titlu?: string
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-border bg-danger-bg px-4 py-3"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-danger" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth={2} />
        <path d="M10 6v5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="1.1" fill="currentColor" />
      </svg>
      <p className="flex-1 text-sm text-danger">
        <span className="font-medium">{titlu}</span> {mesajEroare(eroare)}
      </p>
      {onReincearca !== undefined && (
        <button type="button" onClick={onReincearca} className="buton buton-secundar buton-mic">
          Reîncearcă
        </button>
      )}
    </div>
  )
}

/** The same three states, inside a table body. */
export function RandStare({
  coloane,
  children,
}: {
  coloane: number
  children: ReactNode
}) {
  return (
    <tr>
      <td colSpan={coloane} className="px-4 py-8 text-center text-sm text-ink-muted">
        {children}
      </td>
    </tr>
  )
}

export function RanduriSchelet({ coloane, randuri = 4 }: { coloane: number; randuri?: number }) {
  return (
    <>
      {Array.from({ length: randuri }, (_, i) => (
        <tr key={i} className="border-b border-surface-sunken last:border-0">
          {Array.from({ length: coloane }, (_, j) => (
            <td key={j} className="px-4 py-3">
              <Schelet className={j === 1 ? 'h-3.5 w-48' : 'h-3.5 w-16'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function Insigna({
  fel,
  children,
}: {
  fel: 'succes' | 'neutru' | 'atentie' | 'info' | 'pericol'
  children: ReactNode
}) {
  const clase = {
    succes: 'bg-succes-bg text-succes border-succes-border',
    neutru: 'bg-surface-sunken text-ink-muted border-line',
    atentie: 'bg-atentie-bg text-atentie border-atentie-border',
    info: 'bg-info-bg text-info border-info-border',
    pericol: 'bg-danger-bg text-danger border-danger-border',
  }[fel]
  return <span className={`insigna ${clase}`}>{children}</span>
}

/**
 * A destructive action that asks once, in place.
 *
 * A modal for „sigur?" costs a mouse trip to the middle of the screen and back;
 * this puts the confirmation on the pixel the user just clicked. It gives up
 * after a few seconds so a half-pressed confirmation does not sit there armed.
 */
export function Confirma({
  eticheta,
  intrebare,
  confirmare,
  onConfirma,
  dezactivat = false,
  clasa = 'buton buton-secundar buton-mic',
}: {
  eticheta: string
  intrebare: string
  confirmare: string
  onConfirma: () => void
  dezactivat?: boolean
  clasa?: string
}) {
  const [deschis, setDeschis] = useState(false)

  useEffect(() => {
    if (!deschis) return
    const cronometru = setTimeout(() => setDeschis(false), 8000)
    return () => clearTimeout(cronometru)
  }, [deschis])

  if (!deschis) {
    return (
      <button
        type="button"
        disabled={dezactivat}
        onClick={() => setDeschis(true)}
        className={clasa}
      >
        {eticheta}
      </button>
    )
  }

  return (
    <span
      className="inline-flex flex-wrap items-center gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDeschis(false)
      }}
    >
      <span className="text-[13px] text-ink-secondary">{intrebare}</span>
      <button
        type="button"
        autoFocus
        onClick={() => {
          setDeschis(false)
          onConfirma()
        }}
        className="buton buton-pericol-plin buton-mic"
      >
        {confirmare}
      </button>
      <button
        type="button"
        onClick={() => setDeschis(false)}
        className="buton buton-discret buton-mic"
      >
        Renunță
      </button>
    </span>
  )
}
