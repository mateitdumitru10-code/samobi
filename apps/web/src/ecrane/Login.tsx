import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { apel, EroareApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'

interface Sesiune {
  accessToken: string
  refreshToken: string
}

/**
 * Sign-in goes through the API, not straight to Supabase, so that failed
 * attempts are recorded. The session it returns is handed to the Supabase client
 * afterwards, which then owns refreshing it.
 */
export function Login() {
  const [email, setEmail] = useState('')
  const [parola, setParola] = useState('')

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

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    autentificare.mutate()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <form
        onSubmit={trimite}
        className="w-full max-w-sm space-y-5 rounded-lg border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Samobi</h1>
          <p className="mt-1 text-sm text-neutral-500">Rețete de producție</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-700">Parolă</span>
          <input
            type="password"
            value={parola}
            onChange={(e) => setParola(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </label>

        {autentificare.isError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {autentificare.error instanceof EroareApi
              ? autentificare.error.message
              : 'Autentificarea a eșuat.'}
          </p>
        )}

        <button
          type="submit"
          disabled={autentificare.isPending}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {autentificare.isPending ? 'Se verifică…' : 'Intră în cont'}
        </button>

        <p className="text-xs text-neutral-500">
          Conturile se creează doar prin invitație. Cere-i una administratorului.
        </p>
      </form>
    </main>
  )
}
