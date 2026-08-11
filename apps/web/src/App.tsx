import { useEffect, useState } from 'react'

import { Activare } from './ecrane/Activare.js'
import { Bonuri } from './ecrane/Bonuri.js'
import { Conturi } from './ecrane/Conturi.js'
import { Nomenclator } from './ecrane/Nomenclator.js'
import { Rapoarte } from './ecrane/Rapoarte.js'
import { Login } from './ecrane/Login.js'
import { Modele } from './ecrane/Modele.js'
import { EroareApi } from './lib/api.js'
import { deconecteaza, useSesiuneSupabase, useUtilizator } from './lib/sesiune.js'
import { ETICHETE_ROL } from './ui/roluri.js'
import { Sigla } from './ui/Sigla.js'
import { mesajEroare, Schelet } from './ui/stari.js'

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
    ruta.startsWith('/activare') || ruta.includes('type=invite') || ruta.includes('type=recovery')
  )
}

interface Sectiune {
  cheie: string
  eticheta: string
}

/** Only what the role can actually open; a hidden tab is not a permission. */
function sectiuniPentru(rol: string): Sectiune[] {
  const sectiuni: Sectiune[] = [
    { cheie: 'bonuri', eticheta: 'Bonuri' },
    { cheie: 'modele', eticheta: 'Modele și rețete' },
    { cheie: 'nomenclator', eticheta: 'Nomenclator' },
    { cheie: 'rapoarte', eticheta: 'Cost material' },
  ]
  // „Conturi" means the chart of accounts to anyone who works with SAGA. This
  // tab is about people.
  if (rol === 'admin') sectiuni.push({ cheie: 'utilizatori', eticheta: 'Utilizatori' })
  return sectiuni
}

export function App() {
  const ruta = useRuta()
  const { gata, areSesiune } = useSesiuneSupabase()
  const utilizator = useUtilizator(areSesiune)

  if (esteActivare(ruta)) {
    return <Activare gata={gata} areSesiune={areSesiune} />
  }

  if (!gata || (areSesiune && utilizator.isLoading)) {
    return <ScheletAplicatie />
  }

  // A dead token is a logout; anything else is the API being unreachable, and
  // showing the login form for that makes the user retype a password that was
  // never the problem.
  const esteNeautentificat =
    !areSesiune ||
    (utilizator.error instanceof EroareApi &&
      (utilizator.error.status === 401 || utilizator.error.status === 403))

  if (esteNeautentificat) return <Login />

  if (utilizator.isError || utilizator.data === undefined) {
    return (
      <EcranEroare eroare={utilizator.error} onReincearca={() => void utilizator.refetch()} />
    )
  }

  const eu = utilizator.data
  const sectiuni = sectiuniPentru(eu.rol)
  // `ruta` is pathname + hash; the section is whatever follows the '#/'.
  const indexDiez = ruta.indexOf('#')
  const cerut =
    indexDiez < 0 ? '' : (ruta.slice(indexDiez + 1).replace(/^\//, '').split('?')[0] ?? '')
  const sectiuneCurenta = sectiuni.some((s) => s.cheie === cerut)
    ? cerut
    : (sectiuni[0]?.cheie ?? 'bonuri')

  return (
    <div className="min-h-screen bg-surface-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <h1 className="flex items-center">
            <Sigla inaltime="h-8 sm:h-9" />
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-ink-secondary sm:inline">
              {eu.nume} <span className="text-ink-muted">· {ETICHETE_ROL[eu.rol]}</span>
            </span>
            <button
              type="button"
              onClick={() => void deconecteaza()}
              className="buton buton-secundar buton-mic"
            >
              Ieși
            </button>
          </div>
        </div>
      </header>

      <nav aria-label="Secțiuni" className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
          {sectiuni.map((sectiune) => {
            const activa = sectiuneCurenta === sectiune.cheie
            return (
              <a
                key={sectiune.cheie}
                href={`#/${sectiune.cheie}`}
                aria-current={activa ? 'page' : undefined}
                className={
                  activa
                    ? 'border-b-2 border-brand px-3 py-2.5 text-sm font-medium whitespace-nowrap text-ink'
                    : 'border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-ink-muted hover:text-ink'
                }
              >
                {sectiune.eticheta}
              </a>
            )
          })}
        </div>
      </nav>

      {/* „Modele și rețete" is a two-pane workbench and wants the whole window;
          everything else reads better in a column. */}
      <main
        className={
          sectiuneCurenta === 'modele'
            ? 'px-4 py-4'
            : 'mx-auto max-w-6xl px-6 py-8'
        }
      >
        {sectiuneCurenta === 'utilizatori' && eu.rol === 'admin' && <Conturi utilizator={eu} />}
        {sectiuneCurenta === 'bonuri' && <Bonuri />}
        {sectiuneCurenta === 'modele' && <Modele />}
        {sectiuneCurenta === 'nomenclator' && <Nomenclator />}
        {sectiuneCurenta === 'rapoarte' && <Rapoarte utilizator={eu} />}
      </main>
    </div>
  )
}

/** The chrome, drawn immediately, so a cold start is not a white page. */
function ScheletAplicatie() {
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Sigla inaltime="h-8 sm:h-9" />
          <Schelet className="h-8 w-24" />
        </div>
      </header>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl gap-4 px-6 py-3">
          <Schelet className="h-4 w-16" />
          <Schelet className="h-4 w-28" />
          <Schelet className="h-4 w-24" />
        </div>
      </div>
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-8" aria-live="polite" aria-busy="true">
        <span className="sr-only">Se încarcă…</span>
        <Schelet className="h-28 w-full" />
        <Schelet className="h-64 w-full" />
      </main>
    </div>
  )
}

function EcranEroare({
  eroare,
  onReincearca,
}: {
  eroare: unknown
  onReincearca: () => void
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <Sigla inaltime="h-12" />
      <div className="card mt-8 max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold text-ink">Nu s-a putut contacta serverul.</h1>
        <p className="mt-2 text-sm text-ink-secondary">{mesajEroare(eroare)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          Verifică rețeaua și încearcă din nou. Dacă ține, anunță administratorul.
        </p>
        <button type="button" onClick={onReincearca} className="buton buton-primar mt-5">
          Reîncearcă
        </button>
      </div>
    </main>
  )
}
