import { env } from '../env.js'

import { supabase } from './supabase.js'

export class EroareApi extends Error {
  constructor(
    readonly status: number,
    readonly cod: string,
    mesaj: string,
    readonly detalii?: { camp: string; mesaj: string }[],
  ) {
    super(mesaj)
    this.name = 'EroareApi'
  }
}

interface Optiuni {
  metoda?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  corp?: unknown
  /** Login is the one call made before a session exists. */
  faraToken?: boolean
}

/**
 * Every business call goes through here, with the Supabase access token in the
 * Authorization header. The API re-reads the role from the database on each
 * request, so nothing in this file needs to know or care what the user may do.
 */
export async function apel<T>(cale: string, optiuni: Optiuni = {}): Promise<T> {
  const antete: Record<string, string> = { 'content-type': 'application/json' }

  if (optiuni.faraToken !== true) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token === undefined) {
      throw new EroareApi(401, 'NEAUTENTIFICAT', 'Sesiunea a expirat. Autentifică-te din nou.')
    }
    antete['authorization'] = `Bearer ${token}`
  }

  const raspuns = await fetch(`${env.VITE_API_URL}${cale}`, {
    method: optiuni.metoda ?? 'GET',
    headers: antete,
    ...(optiuni.corp !== undefined ? { body: JSON.stringify(optiuni.corp) } : {}),
  })

  const text = await raspuns.text()
  const continut: unknown = text === '' ? null : JSON.parse(text)

  if (!raspuns.ok) {
    const eroare = continut as { cod?: string; mesaj?: string; detalii?: never }
    if (raspuns.status === 401) await sesiuneaAExpirat()
    throw new EroareApi(
      raspuns.status,
      eroare?.cod ?? 'EROARE',
      eroare?.mesaj ?? 'Cererea a eșuat.',
      eroare?.detalii,
    )
  }

  return continut as T
}

/**
 * A dead token used to surface as „Sesiunea a expirat" inside whichever panel
 * happened to make the call, with the user still looking at an application they
 * could no longer use. Signing out flips the app to the login screen through
 * `onAuthStateChange`, which is the only thing that will actually help.
 */
async function sesiuneaAExpirat(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session === null) return
  sessionStorage.setItem('samobi:sesiune-expirata', '1')
  await supabase.auth.signOut()
}

/**
 * File upload. Separate from `apel` because the body must stay a FormData —
 * setting content-type by hand would strip the multipart boundary and the server
 * would see an empty request.
 */
export async function incarcaFisier<T>(
  cale: string,
  fisier: File,
  campuri: Record<string, string> = {},
): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token === undefined) {
    throw new EroareApi(401, 'NEAUTENTIFICAT', 'Sesiunea a expirat. Autentifică-te din nou.')
  }

  const corp = new FormData()
  for (const [cheie, valoare] of Object.entries(campuri)) corp.append(cheie, valoare)
  corp.append('fisier', fisier)

  const raspuns = await fetch(`${env.VITE_API_URL}${cale}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: corp,
  })

  const text = await raspuns.text()
  const continut: unknown = text === '' ? null : JSON.parse(text)

  if (!raspuns.ok) {
    const eroare = continut as { cod?: string; mesaj?: string }
    if (raspuns.status === 401) await sesiuneaAExpirat()
    throw new EroareApi(raspuns.status, eroare?.cod ?? 'EROARE', eroare?.mesaj ?? 'Import eșuat.')
  }

  return continut as T
}
