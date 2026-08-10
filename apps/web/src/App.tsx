import { useEffect, useState } from 'react'

import { Activare } from './ecrane/Activare.js'
import { Conturi } from './ecrane/Conturi.js'
import { Login } from './ecrane/Login.js'
import { deconecteaza, useSesiuneSupabase, useUtilizator } from './lib/sesiune.js'

/**
 * Routing is the URL fragment, deliberately.
 *
 * The application has two public entry points — sign in and the invitation link
 * Supabase sends — and everything else lives behind the session. A router
 * library would earn its place once there are recipe and bon screens to navigate
 * between; it does not yet.
 */
function useRuta() {
  const [ruta, setRuta] = useState(window.location.hash)
  useEffect(() => {
    const asculta = () => setRuta(window.location.hash)
    window.addEventListener('hashchange', asculta)
    return () => window.removeEventListener('hashchange', asculta)
  }, [])
  return ruta
}

export function App() {
  const ruta = useRuta()
  const { gata, areSesiune } = useSesiuneSupabase()
  const utilizator = useUtilizator(areSesiune)

  if (ruta.startsWith('#/activare') || ruta.includes('type=invite')) {
    return <Activare areSesiune={areSesiune} />
  }

  if (!gata || (areSesiune && utilizator.isLoading)) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        Se încarcă…
      </main>
    )
  }

  if (!areSesiune || utilizator.isError || utilizator.data === undefined) {
    return <Login />
  }

  const eu = utilizator.data

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-base font-semibold text-neutral-900">Samobi</h1>
            <p className="text-xs text-neutral-500">Rețete de producție</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-neutral-600">
              {eu.nume} <span className="text-neutral-400">· {eu.rol}</span>
            </span>
            <button
              type="button"
              onClick={() => void deconecteaza()}
              className="rounded-md border border-neutral-300 px-3 py-1 text-xs"
            >
              Ieși
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {eu.rol === 'admin' ? (
          <Conturi utilizator={eu} />
        ) : (
          <p className="text-sm text-neutral-600">
            Modulele de rețete și bonuri urmează. Deocamdată doar administratorul are un ecran.
          </p>
        )}
      </main>
    </div>
  )
}
