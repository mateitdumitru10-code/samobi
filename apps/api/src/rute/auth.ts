import { schemaLogin } from '@samobi/shared/scheme'
import type { FastifyInstance } from 'fastify'

import { scrieAudit } from '../audit.js'
import { autentifica, utilizatorul, type VerificatorToken } from '../auth.js'
import { Neautentificat } from '../erori.js'
import { supabaseAnon } from '../supabase.js'

/**
 * Login goes through the API rather than straight from the browser to Supabase.
 *
 * SPEC §3 requires auditing failed logins, and only the server can record those
 * reliably — a browser that fails to sign in has no reason to tell us. The API
 * uses the anon key here, exactly the privileges the browser would have had, and
 * never stores the password.
 */
export function ruteAuth(app: FastifyInstance, verifica: VerificatorToken) {
  app.post('/auth/login', async (cerere, raspuns) => {
    const { email, parola } = schemaLogin.parse(cerere.body)

    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password: parola,
    })

    if (error !== null || data.session === null) {
      await scrieAudit(cerere, {
        entitate: 'auth',
        entitateId: email,
        actiune: 'login_esuat',
        diff: { motiv: error?.message ?? 'sesiune lipsă' },
      })
      // Deliberately vague: distinguishing "no such account" from "wrong
      // password" tells an attacker which emails exist.
      throw new Neautentificat('Email sau parolă greșite.')
    }

    await scrieAudit(cerere, {
      userId: data.user?.id ?? null,
      entitate: 'auth',
      entitateId: data.user?.id ?? email,
      actiune: 'login',
    })

    return raspuns.send({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiraLa: data.session.expires_at ?? null,
    })
  })

  app.get('/auth/eu', { preHandler: autentifica(verifica) }, async (cerere) => {
    return utilizatorul(cerere)
  })

  app.post('/auth/logout', { preHandler: autentifica(verifica) }, async (cerere) => {
    const utilizator = utilizatorul(cerere)
    await scrieAudit(cerere, {
      userId: utilizator.id,
      entitate: 'auth',
      entitateId: utilizator.id,
      actiune: 'logout',
    })
    return { deconectat: true }
  })
}
