import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { clientSql } from '../src/db.js'
import { supabaseAdmin, supabaseAnon } from '../src/supabase.js'

import { areBazaDeDate } from './db.js'

/**
 * Made-to-order sizes, end to end.
 *
 * The engine's own tests cover the arithmetic; what is worth proving against a
 * real database is the shape of the bon: no dimension row, the measurements
 * snapshotted on it, and the model's generic article standing in for the one
 * SAGA does not have.
 */

const marcaj = `T${Date.now().toString().slice(-8)}`
const parola = `Pw-${marcaj}-7rT`
const conturi: Record<string, { id: string; token: string }> = {}
const modeleCreate: string[] = []

const ARTICOL_MATERIAL = '00016024'
const ARTICOL_PRODUS = '00022107'

async function creeazaCont(rol: string) {
  const email = `lacomanda-${marcaj}-${rol}@example.com`
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
  conturi[rol] = { id: data.user.id, token: sesiune.data.session.access_token }
}

function antet(rol: string) {
  return { authorization: `Bearer ${conturi[rol]?.token ?? ''}` }
}

describe.skipIf(!areBazaDeDate)('dimensiuni la comandă', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let modelId = ''

  beforeAll(async () => {
    await creeazaCont('tehnolog')
    app = await buildApp()

    const model = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('tehnolog'),
      payload: {
        cod: `TEST-${marcaj}-COMANDA`,
        denumire: 'Pat la comandă',
        familie: 'PAT',
      },
    })
    modelId = (model.json() as { id: string }).id
    modeleCreate.push(modelId)

    await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('tehnolog'),
      payload: {
        cod: '2000x1600',
        lungime: '2000',
        latime: '1600',
        inaltime: '350',
        codSagaProdus: ARTICOL_PRODUS,
      },
    })

    // A recipe that scales: one formula line, so a custom size means something.
    const [reteta] = await clientSql<{ id: string }[]>`
      insert into recipe (model_id, versiune, status) values (${modelId}, 1, 'draft') returning id`
    await clientSql`
      insert into recipe_line
        (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul, formula, procent_pierderi)
      values (${reteta?.id ?? ''}, 1, 'STRUCTURA', ${ARTICOL_MATERIAL}, 'MP', 'formula',
              'L*l/1000000', '0')`
  }, 90_000)

  afterAll(async () => {
    if (modeleCreate.length > 0) {
      const ale_noastre = clientSql`
        id = any(${clientSql.array(modeleCreate)}::uuid[]) and cod like 'TEST-%'`
      await clientSql`delete from production_order_line where production_order_id in (
        select id from production_order where model_id in (select id from model where ${ale_noastre}))`
      await clientSql`delete from production_order where model_id in (
        select id from model where ${ale_noastre})`
      await clientSql`delete from recipe_line where recipe_id in (
        select id from recipe where model_id in (select id from model where ${ale_noastre}))`
      await clientSql`delete from recipe where model_id in (select id from model where ${ale_noastre})`
      await clientSql`delete from dimension where model_id in (select id from model where ${ale_noastre})`
      await clientSql`delete from model where ${ale_noastre}`
    }
    for (const cont of Object.values(conturi)) {
      await supabaseAdmin.auth.admin.deleteUser(cont.id)
    }
    await app.close()
    await clientSql.end({ timeout: 5 })
  }, 60_000)

  function bonLaComanda(dimensiune: Record<string, string | null>, extra = {}) {
    return app.inject({
      method: 'POST',
      url: '/bonuri',
      headers: antet('tehnolog'),
      payload: {
        modelId,
        dimensiune,
        cantitate: '1',
        data: new Date().toISOString().slice(0, 10),
        gestiuneProdus: 'MATERII PRIME',
        ...extra,
      },
    })
  }

  it('refuză o dimensiune la comandă cât timp modelul nu e deschis pentru ea', async () => {
    const res = await bonLaComanda({ lungime: '2150', latime: '1450', inaltime: '400' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/nu acceptă dimensiuni la comandă/i)
  })

  it('declară intervalul și avertizează despre ce nu ține la capete', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/modele/${modelId}/la-comanda`,
      headers: antet('tehnolog'),
      payload: {
        lungimeMin: '1800',
        lungimeMax: '2200',
        latimeMin: '800',
        latimeMax: '2000',
        inaltimeMin: '300',
        inaltimeMax: '450',
        codSagaProdusComanda: ARTICOL_PRODUS,
      },
    })
    expect(res.statusCode).toBe(200)
    // The one formula holds everywhere in the range, so nothing to say.
    expect((res.json() as { avertismente: unknown[] }).avertismente).toEqual([])
  })

  it('refuză un cod de predare care nu e produs finit', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/modele/${modelId}/la-comanda`,
      headers: antet('tehnolog'),
      payload: {
        lungimeMin: '1800',
        lungimeMax: '2200',
        latimeMin: '800',
        latimeMax: '2000',
        inaltimeMin: null,
        inaltimeMax: null,
        codSagaProdusComanda: ARTICOL_MATERIAL,
      },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/nu este produs finit/i)
  })

  it('refuză o dimensiune în afara intervalului, numind axa', async () => {
    const res = await bonLaComanda({ lungime: '2500', latime: '1450', inaltime: '400' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/Lungime/)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/1800–2200/)
  })

  it('emite bonul, fără dimensiune înregistrată, cu măsurile pe el', async () => {
    const res = await bonLaComanda({ lungime: '2150', latime: '1450', inaltime: '400' })
    expect(res.statusCode).toBe(201)

    const bon = res.json() as { id: string; dimensionId: string | null; lungime: string }
    expect(bon.dimensionId).toBeNull()
    expect(Number(bon.lungime)).toBe(2150)

    const [rand] = await clientSql<
      { lungime: string; latime: string; inaltime: string; motor_calcul: string; cod: string }[]
    >`
      select lungime, latime, inaltime, motor_calcul, cod_saga_produs as cod
      from production_order where id = ${bon.id}`
    expect(Number(rand?.latime)).toBe(1450)
    expect(Number(rand?.inaltime)).toBe(400)
    expect(rand?.motor_calcul).toBe('calcul/2')
    // The model's generic article, since the size has none of its own.
    expect(rand?.cod).toBe(ARTICOL_PRODUS)

    // 2150 × 1450 / 1e6 = 3.1175 m²
    const [linie] = await clientSql<{ cantitate_bruta: string; contributii: unknown[] }[]>`
      select cantitate_bruta, contributii from production_order_line
      where production_order_id = ${bon.id}`
    expect(Number(linie?.cantitate_bruta)).toBeCloseTo(3.1175, 6)
    // Every contribution kept, with its own formula, not just the first.
    expect(linie?.contributii).toHaveLength(1)
    expect((linie?.contributii[0] as { formula: string }).formula).toBe('L*l/1000000')
  })

  it('cere cantitățile pentru liniile «tabel», cu numerele liniilor', async () => {
    const [reteta] = await clientSql<{ id: string }[]>`
      select id from recipe where model_id = ${modelId} limit 1`
    await clientSql`
      insert into recipe_line
        (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul, procent_pierderi)
      values (${reteta?.id ?? ''}, 2, 'TAPITERIE', ${ARTICOL_MATERIAL}, 'MP', 'tabel', '0')`

    const res = await bonLaComanda({ lungime: '2150', latime: '1450', inaltime: '400' })
    expect(res.statusCode).toBe(400)

    const corp = res.json() as { mesaj: string; detalii?: { liniiManuale?: { nrLinie: number }[] } }
    expect(corp.mesaj).toMatch(/tabel/)
    expect(corp.detalii?.liniiManuale?.[0]?.nrLinie).toBe(2)

    await clientSql`delete from recipe_line where recipe_id = ${reteta?.id ?? ''} and nr_linie = 2`
  })
})
