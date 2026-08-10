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
  metoda?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
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
    throw new EroareApi(
      raspuns.status,
      eroare?.cod ?? 'EROARE',
      eroare?.mesaj ?? 'Cererea a eșuat.',
      eroare?.detalii,
    )
  }

  return continut as T
}
