import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { apel, EroareApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { CampParola } from '../ui/CampParola.js'
import { Sigla } from '../ui/Sigla.js'

interface Sesiune {
  accessToken: string
  refreshToken: string
}

/** What went wrong, in terms the person in front of the screen can act on. */
function mesajAutentificare(eroare: unknown): string {
  if (eroare instanceof EroareApi) {
    if (eroare.status === 401) return 'Email sau parolă greșite.'
    if (eroare.status === 429) return 'Prea multe încercări. Așteaptă un minut.'
    if (eroare.status === 403) return eroare.message
    return eroare.message
  }
  if (eroare instanceof TypeError) {
    return 'Nu s-a putut contacta serverul. Verifică rețeaua.'
  }
  return 'Autentificarea a eșuat.'
}

/**
 * Sign-in goes through the API, not straight to Supabase, so that failed
 * attempts are recorded. The session it returns is handed to the Supabase client
 * afterwards, which then owns refreshing it.
 */
export function Login() {
  const [email, setEmail] = useState('')
  const [parola, setParola] = useState('')
  const [resetat, setResetat] = useState(false)
  const eroareRef = useRef<HTMLParagraphElement>(null)

  // Set by `apel` when a request came back 401 and signed the session out.
  const [expirata] = useState(() => {
    const avea = sessionStorage.getItem('samobi:sesiune-expirata') === '1'
    sessionStorage.removeItem('samobi:sesiune-expirata')
    return avea
  })

  const autentificare = useMutation({
    mutationFn: async () => {
      const sesiune = await apel<Sesiune>('/auth/login', {
        metoda: 'POST',
        corp: { email, parola },
        faraToken: true,
      })
      const { error } = await supabase.auth.setSession({
        access_token: sesiune.accessToken,
        refresh_token: sesiune.refreshToken,
      })
      if (error !== null) throw new Error(error.message)
    },
  })

  // A screen reader user who submits and hears nothing has no way to know why.
  useEffect(() => {
    if (autentificare.isError) eroareRef.current?.focus()
  }, [autentificare.isError])

  const resetare = useMutation({
    mutationFn: async () => {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/activare`,
      })
    },
    onSuccess: () => setResetat(true),
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    autentificare.mutate()
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-page p-6">
      <Sigla inaltime="h-14" />

      <form onSubmit={trimite} className="card w-full max-w-sm space-y-5 p-8">
        <h1 className="text-lg font-semibold text-ink">Intră în cont</h1>

        {expirata && (
          <p className="rounded-lg border border-atentie-border bg-atentie-bg px-3 py-2 text-sm text-atentie">
            Sesiunea a expirat. Intră din nou.
          </p>
        )}

        <div>
          <label htmlFor="email" className="eticheta">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
            className="camp"
          />
        </div>

        <CampParola
          id="parola"
          eticheta="Parolă"
          valoare={parola}
          onSchimba={setParola}
          autoComplete="current-password"
        />

        {autentificare.isError && (
          <p
            ref={eroareRef}
            role="alert"
            tabIndex={-1}
            className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger"
          >
            {mesajAutentificare(autentificare.error)}
          </p>
        )}

        <button type="submit" disabled={autentificare.isPending} className="buton buton-primar w-full">
          {autentificare.isPending ? 'Se verifică…' : 'Intră în cont'}
        </button>

        {resetat ? (
          <p className="text-xs text-ink-muted">
            Dacă adresa există, primești un link de resetare pe email.
          </p>
        ) : (
          <button
            type="button"
            disabled={email.trim() === '' || resetare.isPending}
            onClick={() => resetare.mutate()}
            className="text-xs text-brand underline underline-offset-2 disabled:text-ink-disabled disabled:no-underline"
            title={email.trim() === '' ? 'Scrie întâi adresa de email' : undefined}
          >
            Ți-ai uitat parola?
          </button>
        )}

        <p className="border-t border-line pt-4 text-xs text-ink-muted">
          Conturile se creează doar prin invitație. Cere-i una administratorului.
        </p>
      </form>
    </main>
  )
}
