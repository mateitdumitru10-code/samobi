import { useEffect, useState } from 'react'

import { Activare } from './ecrane/Activare.js'
import { Conturi } from './ecrane/Conturi.js'
import { Nomenclator } from './ecrane/Nomenclator.js'
import { Login } from './ecrane/Login.js'
import { Modele } from './ecrane/Modele.js'
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
  const [ruta, setRuta] = useState(window.location.pathname + window.location.hash)
  useEffect(() => {
    const asculta = () => setRuta(window.location.pathname + window.location.hash)
    window.addEventListener('hashchange', asculta)
    window.addEventListener('popstate', asculta)
    return () => {
      window.removeEventListener('hashchange', asculta)
      window.removeEventListener('popstate', asculta)
    }
  }, [])
  return ruta
}

/**
 * Activation arrives as a path, not a fragment. Supabase appends its own
 * `#access_token=...` to whatever redirect it is given, so a target ending in
 * `#/activare` would produce two fragments and supabase-js would never find the
 * session. The `type=` check covers a link that landed on the site root because
 * the redirect was not in the allow-list.
 */
function esteActivare(ruta: string): boolean {
  return (
    ruta.startsWith('/activare') ||
    ruta.includes('type=invite') ||
    ruta.includes('type=recovery')
  )
}

interface Sectiune {
  cheie: string
  eticheta: string
}

/** Only what the role can actually open; a hidden tab is not a permission. */
function sectiuniPentru(rol: string): Sectiune[] {
  const sectiuni: Sectiune[] = [
    { cheie: 'modele', eticheta: 'Modele și rețete' },
    { cheie: 'nomenclator', eticheta: 'Nomenclator' },
  ]
  if (rol === 'admin') sectiuni.push({ cheie: 'conturi', eticheta: 'Conturi' })
  return sectiuni
}

export function App() {
  const ruta = useRuta()
  const { gata, areSesiune } = useSesiuneSupabase()
  const utilizator = useUtilizator(areSesiune)

  if (esteActivare(ruta)) {
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
  const sectiuni = sectiuniPentru(eu.rol)
  // `ruta` is pathname + hash; the section is whatever follows the '#/'.
  const indexDiez = ruta.indexOf('#')
  const cerut =
    indexDiez < 0 ? '' : (ruta.slice(indexDiez + 1).replace(/^\//, '').split('?')[0] ?? '')
  const sectiuneCurenta = sectiuni.some((s) => s.cheie === cerut)
    ? cerut
    : (sectiuni[0]?.cheie ?? 'modele')

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

      <nav className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl gap-1 px-6">
          {sectiuniPentru(eu.rol).map((sectiune) => (
            <a
              key={sectiune.cheie}
              href={`#/${sectiune.cheie}`}
              className={
                sectiuneCurenta === sectiune.cheie
                  ? 'border-b-2 border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900'
                  : 'border-b-2 border-transparent px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900'
              }
            >
              {sectiune.eticheta}
            </a>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {sectiuneCurenta === 'conturi' && eu.rol === 'admin' && <Conturi utilizator={eu} />}
        {sectiuneCurenta === 'modele' && <Modele utilizator={eu} />}
        {sectiuneCurenta === 'nomenclator' && <Nomenclator utilizator={eu} />}
      </main>
    </div>
  )
}
