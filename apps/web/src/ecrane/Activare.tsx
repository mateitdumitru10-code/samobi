import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { supabase } from '../lib/supabase.js'

/**
 * Where the invitation link lands. Supabase has already turned the URL fragment
 * into a session by the time this renders, so all that is left is choosing a
 * password. Nothing about hashing, tokens or expiry is our business.
 */
export function Activare({ areSesiune }: { areSesiune: boolean }) {
  const [parola, setParola] = useState('')
  const [confirmare, setConfirmare] = useState('')

  const setare = useMutation({
    mutationFn: async () => {
      if (parola !== confirmare) throw new Error('Parolele nu coincid.')
      if (parola.length < 8) throw new Error('Parola trebuie să aibă cel puțin 8 caractere.')
      const { error } = await supabase.auth.updateUser({ password: parola })
      if (error !== null) throw new Error(error.message)
      window.location.hash = ''
    },
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    setare.mutate()
  }

  if (!areSesiune) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm space-y-2 text-center">
          <h1 className="text-lg font-semibold">Link expirat</h1>
          <p className="text-sm text-neutral-600">
            Invitația nu mai este validă. Cere-i administratorului una nouă.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <form
        onSubmit={trimite}
        className="w-full max-w-sm space-y-5 rounded-lg border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Alege-ți parola</h1>
          <p className="mt-1 text-sm text-neutral-500">Ultimul pas înainte de a intra în cont.</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-700">Parolă nouă</span>
          <input
            type="password"
            value={parola}
            onChange={(e) => setParola(e.target.value)}
            required
            autoComplete="new-password"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-700">Confirmă parola</span>
          <input
            type="password"
            value={confirmare}
            onChange={(e) => setConfirmare(e.target.value)}
            required
            autoComplete="new-password"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </label>

        {setare.isError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {(setare.error as Error).message}
          </p>
        )}

        <button
          type="submit"
          disabled={setare.isPending}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {setare.isPending ? 'Se salvează…' : 'Salvează parola'}
        </button>
      </form>
    </main>
  )
}
