import { profile } from '@samobi/shared/db'
import type { RolValidat, UtilizatorCurent } from '@samobi/shared/scheme'
import { eq } from 'drizzle-orm'
import type { FastifyRequest, preHandlerHookHandler } from 'fastify'

import { db } from './db.js'
import { Interzis, Neautentificat } from './erori.js'
import { supabaseAdmin } from './supabase.js'

declare module 'fastify' {
  interface FastifyRequest {
    utilizator?: UtilizatorCurent
  }
}

export interface IdentitateToken {
  id: string
  email: string | null
}

/** Swappable so tests can drive the guards without minting real Supabase tokens. */
export type VerificatorToken = (token: string) => Promise<IdentitateToken | null>

export const verificatorSupabase: VerificatorToken = async (token) => {
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error !== null || data.user === null) return null
  return { id: data.user.id, email: data.user.email ?? null }
}

function extrageToken(cerere: FastifyRequest): string | null {
  const antet = cerere.headers.authorization
  if (antet === undefined) return null
  const [schema, token] = antet.split(' ')
  if (schema?.toLowerCase() !== 'bearer' || token === undefined || token === '') return null
  return token
}

/**
 * Validates the bearer token, then reads the role from `profile`.
 *
 * The role is never taken from the token. A JWT issued an hour ago still claims
 * whatever it claimed then; the table knows what is true now. The same reasoning
 * applies to `activ`: a banned user may still hold a token that has not expired.
 */
export function autentifica(verifica: VerificatorToken): preHandlerHookHandler {
  return async (cerere) => {
    const token = extrageToken(cerere)
    if (token === null) throw new Neautentificat()

    const identitate = await verifica(token)
    if (identitate === null) throw new Neautentificat('Sesiunea a expirat. Autentifică-te din nou.')

    const [rand] = await db
      .select({
        id: profile.id,
        nume: profile.nume,
        rol: profile.rol,
        activ: profile.activ,
      })
      .from(profile)
      .where(eq(profile.id, identitate.id))
      .limit(1)

    if (rand === undefined) {
      throw new Neautentificat('Contul nu are profil. Anunță administratorul.')
    }
    if (!rand.activ) {
      throw new Interzis('Contul este dezactivat.')
    }

    cerere.utilizator = {
      id: rand.id,
      email: identitate.email,
      nume: rand.nume,
      rol: rand.rol as RolValidat,
      activ: rand.activ,
    }
  }
}

/**
 * Every route states its own roles. There is no inherited permission and no
 * default-allow — a route without this guard is a route nobody authorised.
 */
/**
 * Every role, which is to say: being signed in is the whole check.
 *
 * The factory has five people and they cover for each other; a tehnolog who
 * cannot issue a bon on the day the operator is away is a rule that stops work
 * rather than protecting it. Accounts stay with the admin — that is the one
 * place where a mistake locks somebody out of their own tool.
 */
export const TOTI: readonly RolValidat[] = ['admin', 'tehnolog', 'operator', 'contabil']

export function ceruRol(...roluri: readonly RolValidat[]): preHandlerHookHandler {
  return async (cerere) => {
    const utilizator = cerere.utilizator
    if (utilizator === undefined) throw new Neautentificat()
    if (!roluri.includes(utilizator.rol)) {
      throw new Interzis(
        `Acțiunea cere rolul ${roluri.join(' sau ')}. Tu ești ${utilizator.rol}.`,
      )
    }
  }
}

/** Reads the authenticated user, or fails loudly if a guard was forgotten. */
export function utilizatorul(cerere: FastifyRequest): UtilizatorCurent {
  const utilizator = cerere.utilizator
  if (utilizator === undefined) throw new Neautentificat()
  return utilizator
}
