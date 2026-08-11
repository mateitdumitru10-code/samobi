import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { clientSql } from '../src/db.js'
import { supabaseAdmin, supabaseAnon } from '../src/supabase.js'

import { areBazaDeDate } from './db.js'

/**
 * Guard tests that need no network: a request without a usable token must never
 * reach a route handler.
 */
describe('token lipsă sau invalid', () => {
  it('respinge o cerere fără antet Authorization', async () => {
    const app = await buildApp({ verificaToken: async () => null })
    const res = await app.inject({ method: 'GET', url: '/auth/eu' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ cod: 'NEAUTENTIFICAT' })
    await app.close()
  })

  it('respinge o schemă de autorizare greșită', async () => {
    const app = await buildApp({ verificaToken: async () => ({ id: 'x', email: null }) })
    const res = await app.inject({
      method: 'GET',
      url: '/auth/eu',
      headers: { authorization: 'Basic YWJjOmRlZg==' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('respinge un token pe care Supabase nu îl recunoaște', async () => {
    const app = await buildApp({ verificaToken: async () => null })
    const res = await app.inject({
      method: 'GET',
      url: '/conturi',
      headers: { authorization: 'Bearer token-inventat' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})

/**
 * End-to-end role checks against the real project: real Supabase users, real
 * JWTs, real profile rows created by the trigger. Accounts are created with
 * createUser rather than an invitation so no email is sent to a fake address,
 * and every one of them is deleted afterwards.
 */
describe.skipIf(!areBazaDeDate)('roluri, capăt la capăt', () => {
  const marcaj = `test-${Date.now()}`
  const parola = `Pw-${marcaj}-9xQ`
  const conturi: Record<string, { id: string; email: string; token: string }> = {}

  async function creeazaCont(rol: string) {
    const email = `${marcaj}-${rol}@example.com`
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: parola,
      email_confirm: true,
      user_metadata: { nume: `Test ${rol}`, rol },
    })
    if (error !== null || data.user === null) throw new Error(error?.message ?? 'cont necreat')

    const sesiune = await supabaseAnon.auth.signInWithPassword({ email, password: parola })
    if (sesiune.error !== null || sesiune.data.session === null) {
      throw new Error(sesiune.error?.message ?? 'sesiune necreată')
    }
    conturi[rol] = { id: data.user.id, email, token: sesiune.data.session.access_token }
  }

  beforeAll(async () => {
    await creeazaCont('admin')
    await creeazaCont('operator')
  }, 60_000)

  afterAll(async () => {
    for (const cont of Object.values(conturi)) {
      await supabaseAdmin.auth.admin.deleteUser(cont.id)
    }
    await clientSql.end({ timeout: 5 })
  }, 60_000)

  it('trigger-ul creează profilul cu rolul din metadata', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/auth/eu',
      headers: { authorization: `Bearer ${conturi['admin']?.token ?? ''}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ rol: 'admin', nume: 'Test admin', activ: true })
    await app.close()
  })

  it('un operator primește 403 pe rutele de admin', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/conturi',
      headers: { authorization: `Bearer ${conturi['operator']?.token ?? ''}` },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ cod: 'INTERZIS' })
    await app.close()
  })

  it('garda de rol refuză un rol care nu e în listă', async () => {
    const app = await buildApp()
    // Business routes no longer restrict by role — only accounts do. The guard
    // itself is still what protects them, so it is tested on a route of its own.
    const { autentifica, ceruRol, verificatorSupabase } = await import('../src/auth.js')
    app.get(
      '/test/retete',
      { preHandler: [autentifica(verificatorSupabase), ceruRol('tehnolog', 'admin')] },
      async () => ({ ok: true }),
    )

    const respinsa = await app.inject({
      method: 'GET',
      url: '/test/retete',
      headers: { authorization: `Bearer ${conturi['operator']?.token ?? ''}` },
    })
    expect(respinsa.statusCode).toBe(403)

    const acceptata = await app.inject({
      method: 'GET',
      url: '/test/retete',
      headers: { authorization: `Bearer ${conturi['admin']?.token ?? ''}` },
    })
    expect(acceptata.statusCode).toBe(200)
    await app.close()
  })

  it('adminul își vede lista de conturi', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/conturi',
      headers: { authorization: `Bearer ${conturi['admin']?.token ?? ''}` },
    })
    expect(res.statusCode).toBe(200)
    const lista = res.json() as { id: string }[]
    expect(lista.map((c) => c.id)).toContain(conturi['operator']?.id)
    await app.close()
  })

  it('adminul nu își poate dezactiva propriul cont', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/conturi/${conturi['admin']?.id ?? ''}/dezactivare`,
      headers: { authorization: `Bearer ${conturi['admin']?.token ?? ''}` },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('dezactivarea invalidează sesiunea deja emisă', async () => {
    const app = await buildApp()
    const operator = conturi['operator']

    const dezactivare = await app.inject({
      method: 'POST',
      url: `/conturi/${operator?.id ?? ''}/dezactivare`,
      headers: { authorization: `Bearer ${conturi['admin']?.token ?? ''}` },
    })
    expect(dezactivare.statusCode).toBe(200)

    // Acelasi token de dinainte de dezactivare. Fara ban, ar functiona in
    // continuare pana la expirare.
    const dupa = await app.inject({
      method: 'GET',
      url: '/auth/eu',
      headers: { authorization: `Bearer ${operator?.token ?? ''}` },
    })
    expect([401, 403]).toContain(dupa.statusCode)

    await app.inject({
      method: 'POST',
      url: `/conturi/${operator?.id ?? ''}/reactivare`,
      headers: { authorization: `Bearer ${conturi['admin']?.token ?? ''}` },
    })
    await app.close()
  })

  it('auditează login-ul eșuat fără să spună dacă adresa există', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: conturi['admin']?.email ?? '', parola: 'parola-gresita' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ mesaj: 'Email sau parolă greșite.' })

    const [rand] = await clientSql`
      select actiune from audit_log
      where entitate = 'auth' and entitate_id = ${conturi['admin']?.email ?? ''}
      order by creat_la desc limit 1`
    expect(rand?.['actiune']).toBe('login_esuat')
    await app.close()
  })

  it('login-ul reușit întoarce o sesiune și lasă urmă în audit', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: conturi['admin']?.email ?? '', parola },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('accessToken')

    const [rand] = await clientSql`
      select actiune from audit_log
      where entitate = 'auth' and entitate_id = ${conturi['admin']?.id ?? ''}
      order by creat_la desc limit 1`
    expect(rand?.['actiune']).toBe('login')
    await app.close()
  })
})
