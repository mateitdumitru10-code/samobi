import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { supabase } from '../lib/supabase.js'
import { CampParola } from '../ui/CampParola.js'
import { Schelet } from '../ui/stari.js'
import { Sigla } from '../ui/Sigla.js'

const LUNGIME_MINIMA = 8

/** Supabase answers in English; this is a Romanian screen. */
function mesajSupabase(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('should be different')) return 'Parola nouă trebuie să difere de cea veche.'
  if (t.includes('at least') || t.includes('too short')) {
    return `Parola trebuie să aibă cel puțin ${LUNGIME_MINIMA} caractere.`
  }
  if (t.includes('expired') || t.includes('invalid')) {
    return 'Linkul nu mai este valid. Cere-i administratorului o invitație nouă.'
  }
  return 'Nu s-a putut salva parola. Încearcă din nou.'
}

/**
 * Where the invitation link lands. Supabase has already turned the URL fragment
 * into a session by the time this renders, so all that is left is choosing a
 * password. Nothing about hashing, tokens or expiry is our business.
 */
export function Activare({ gata, areSesiune }: { gata: boolean; areSesiune: boolean }) {
  const [parola, setParola] = useState('')
  const [confirmare, setConfirmare] = useState('')
  const [atins, setAtins] = useState(false)

  const preaScurta = parola !== '' && parola.length < LUNGIME_MINIMA
  const nuCoincid = confirmare !== '' && parola !== confirmare

  const setare = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password: parola })
      if (error !== null) throw new Error(mesajSupabase(error.message))
      // Leave the recovery fragment behind, and land on the app proper.
      window.location.replace('/')
    },
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    setAtins(true)
    if (preaScurta || nuCoincid || parola.length < LUNGIME_MINIMA || parola !== confirmare) return
    setare.mutate()
  }

  // Supabase is still parsing the fragment. Announcing „link expirat" here was
  // telling every legitimate invitee, with full confidence, something false.
  if (!gata) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
        <Sigla inaltime="h-14" />
        <div className="card w-full max-w-sm space-y-4 p-8" aria-busy="true">
          <span className="sr-only">Se verifică linkul…</span>
          <Schelet className="h-5 w-40" />
          <Schelet className="h-10 w-full" />
          <Schelet className="h-10 w-full" />
        </div>
      </main>
    )
  }

  if (!areSesiune) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
        <Sigla inaltime="h-14" />
        <div className="card max-w-sm p-8 text-center">
          <h1 className="text-lg font-semibold text-ink">Link expirat</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            Invitația nu mai este validă. Cere-i administratorului să ți-o retrimită.
          </p>
          <button
            type="button"
            onClick={() => window.location.replace('/')}
            className="buton buton-secundar mt-5"
          >
            Mergi la autentificare
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-page p-6">
      <Sigla inaltime="h-14" />

      <form onSubmit={trimite} className="card w-full max-w-sm space-y-5 p-8">
        <div>
          <h1 className="text-lg font-semibold text-ink">Alege-ți parola</h1>
          <p className="mt-1 text-sm text-ink-muted">Ultimul pas înainte de a intra în cont.</p>
        </div>

        <CampParola
          id="parola-noua"
          eticheta="Parolă nouă"
          valoare={parola}
          onSchimba={setParola}
          autoComplete="new-password"
          autoFocus
          indiciu={`Minim ${LUNGIME_MINIMA} caractere.`}
          {...(atins && preaScurta
            ? { eroare: `Prea scurtă — minim ${LUNGIME_MINIMA} caractere.` }
            : {})}
        />

        <CampParola
          id="parola-confirmare"
          eticheta="Confirmă parola"
          valoare={confirmare}
          onSchimba={setConfirmare}
          autoComplete="new-password"
          {...(nuCoincid ? { eroare: 'Parolele nu coincid.' } : {})}
        />

        {setare.isError && (
          <p
            role="alert"
            className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger"
          >
            {(setare.error as Error).message}
          </p>
        )}

        <button type="submit" disabled={setare.isPending} className="buton buton-primar w-full">
          {setare.isPending ? 'Se salvează…' : 'Salvează parola'}
        </button>
      </form>
    </main>
  )
}
