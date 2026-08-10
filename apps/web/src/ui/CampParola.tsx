import { useState } from 'react'

/**
 * A password field you can look at.
 *
 * Most failed sign-ins here are typos, and on the workshop tablet's keyboard a
 * masked field gives no way to find one. The toggle is a button rather than a
 * checkbox so it sits inside the field without stealing the tab order twice.
 */
export function CampParola({
  id,
  eticheta,
  valoare,
  onSchimba,
  indiciu,
  eroare,
  autoComplete = 'current-password',
  autoFocus = false,
}: {
  id: string
  eticheta: string
  valoare: string
  onSchimba: (v: string) => void
  indiciu?: string
  eroare?: string
  autoComplete?: string
  autoFocus?: boolean
}) {
  const [vizibila, setVizibila] = useState(false)

  return (
    <div>
      <label htmlFor={id} className="eticheta">
        {eticheta}
      </label>
      <div className="relative">
        <input
          id={id}
          type={vizibila ? 'text' : 'password'}
          value={valoare}
          onChange={(e) => onSchimba(e.target.value)}
          required
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          aria-invalid={eroare !== undefined}
          aria-describedby={eroare !== undefined ? `${id}-eroare` : indiciu !== undefined ? `${id}-indiciu` : undefined}
          className="camp pr-11"
        />
        <button
          type="button"
          onClick={() => setVizibila((v) => !v)}
          aria-label={vizibila ? 'Ascunde parola' : 'Arată parola'}
          aria-pressed={vizibila}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-muted hover:text-ink"
        >
          {vizibila ? (
            <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" aria-hidden="true">
              <path
                d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
              />
              <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth={1.6} />
              <path d="M3.5 16.5l13-13" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" aria-hidden="true">
              <path
                d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
              />
              <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth={1.6} />
            </svg>
          )}
        </button>
      </div>
      {eroare !== undefined ? (
        <p id={`${id}-eroare`} className="indiciu text-danger">
          {eroare}
        </p>
      ) : (
        indiciu !== undefined && (
          <p id={`${id}-indiciu`} className="indiciu">
            {indiciu}
          </p>
        )
      )}
    </div>
  )
}
