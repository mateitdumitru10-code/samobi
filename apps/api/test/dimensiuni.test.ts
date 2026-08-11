import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { clientSql } from '../src/db.js'
import { supabaseAdmin, supabaseAnon } from '../src/supabase.js'

import { areBazaDeDate } from './db.js'

/**
 * Adding a size, and issuing on it.
 *
 * This is the whole of what „produce it at another size" now means: a new row
 * in the model's dimensions, and the same recipe evaluated against it. Worth a
 * test against a real database because the two halves live in different places
 * — the dimension carries the SAGA article, the recipe carries the formulas —
 * and a bon needs both to line up.
 */

const marcaj = `T${Date.now().toString().slice(-8)}`
const parola = `Pw-${marcaj}-3zR`
const conturi: Record<string, { id: string; token: string }> = {}
const modeleCreate: string[] = []

const ARTICOL_MATERIAL = '00016024'
const ARTICOL_PRODUS = '00022107'

async function creeazaCont(rol: string) {
  const email = `dim-${marcaj}-${rol}@example.com`
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

describe.skipIf(!areBazaDeDate)('dimensiuni noi', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let modelId = ''

  beforeAll(async () => {
    // An operator, deliberately: adding a size is everyone's job now.
    await creeazaCont('operator')
    app = await buildApp()

    const model = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('operator'),
      payload: { cod: `TEST-${marcaj}-DIM`, denumire: 'Model dimensiuni', familie: 'PAT' },
    })
    modelId = (model.json() as { id: string }).id
    modeleCreate.push(modelId)

    const [reteta] = await clientSql<{ id: string }[]>`
      insert into recipe (model_id, versiune) values (${modelId}, 1) returning id`
    await clientSql`
      insert into recipe_line
        (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul, formula, procent_pierderi)
      values (${reteta?.id ?? ''}, 1, 'STRUCTURA', ${ARTICOL_MATERIAL}, 'MP', 'formula',
              'L*l/1000000', '0')`
    await clientSql`
      insert into recipe_line
        (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul, cantitate_fixa, procent_pierderi)
      values (${reteta?.id ?? ''}, 2, 'ACCESORII', ${ARTICOL_MATERIAL}, 'MP', 'fixa', '4', '0')`
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

  async function adaugaDimensiune(cod: string, lungime: string, latime: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('operator'),
      payload: { cod, lungime, latime, inaltime: '350', codSagaProdus: ARTICOL_PRODUS },
    })
    expect(res.statusCode).toBe(201)
    return (res.json() as { id: string }).id
  }

  async function consumPeDimensiune(dimensiuneId: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/bonuri/previzualizare',
      headers: antet('operator'),
      payload: { modelId, dimensiuneId, cantitate: '1' },
    })
    expect(res.statusCode).toBe(200)
    const corp = res.json() as { linii: { cantitateBrutaRotunjita: string }[] }
    return Number(corp.linii[0]?.cantitateBrutaRotunjita)
  }

  it('o dimensiune nouă schimbă consumul pe liniile cu formulă', async () => {
    const mica = await adaugaDimensiune('2000x1400', '2000', '1400')
    const mare = await adaugaDimensiune('2000x1800', '2000', '1800')

    // 2 × 1,4 = 2,8 m² faţă de 2 × 1,8 = 3,6 m². Plus 4 constante, agregate pe
    // acelaşi articol: 6,8 respectiv 7,6.
    expect(await consumPeDimensiune(mica)).toBeCloseTo(6.8, 3)
    expect(await consumPeDimensiune(mare)).toBeCloseTo(7.6, 3)
  })

  it('bonul se emite pe dimensiunea nouă și îi păstrează măsurile', async () => {
    const dimensiuneId = await adaugaDimensiune('2000x1600', '2000', '1600')

    const res = await app.inject({
      method: 'POST',
      url: '/bonuri',
      headers: antet('operator'),
      payload: {
        modelId,
        dimensiuneId,
        cantitate: '1',
        data: new Date().toISOString().slice(0, 10),
        gestiuneProdus: 'MATERII PRIME',
      },
    })
    expect(res.statusCode).toBe(201)

    const bon = res.json() as { id: string }
    const [rand] = await clientSql<{ lungime: string; latime: string; cod: string }[]>`
      select lungime, latime, cod_saga_produs as cod
      from production_order where id = ${bon.id}`
    // The measurements travel onto the bon, so a later edit of the dimension
    // cannot change what the document meant.
    expect(Number(rand?.lungime)).toBe(2000)
    expect(Number(rand?.latime)).toBe(1600)
    expect(rand?.cod).toBe(ARTICOL_PRODUS)
  })

  it('refuză schimbarea măsurilor unei dimensiuni pe care s-au emis bonuri', async () => {
    const dimensiuneId = await adaugaDimensiune('2000x2000', '2000', '2000')

    await app.inject({
      method: 'POST',
      url: '/bonuri',
      headers: antet('operator'),
      payload: {
        modelId,
        dimensiuneId,
        cantitate: '1',
        data: new Date().toISOString().slice(0, 10),
        gestiuneProdus: 'MATERII PRIME',
      },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/modele/${modelId}/dimensiuni/${dimensiuneId}`,
      headers: antet('operator'),
      payload: { lungime: '2100' },
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/bonuri emise/i)
  })

  it('lasă redenumirea unei dimensiuni cu bonuri, chiar dacă se retrimit măsurile', async () => {
    const dimensiuneId = await adaugaDimensiune('2000x2200', '2000', '2200')

    await app.inject({
      method: 'POST',
      url: '/bonuri',
      headers: antet('operator'),
      payload: {
        modelId,
        dimensiuneId,
        cantitate: '1',
        data: new Date().toISOString().slice(0, 10),
        gestiuneProdus: 'MATERII PRIME',
      },
    })

    // The edit form sends every field. „2000" against a stored „2000.000000"
    // is not a change, and refusing it would block the one edit that is always
    // allowed on a dimension that has been used.
    const res = await app.inject({
      method: 'PATCH',
      url: `/modele/${modelId}/dimensiuni/${dimensiuneId}`,
      headers: antet('operator'),
      payload: { cod: 'STANDARD-2200', lungime: '2000', latime: '2200', inaltime: '350' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { cod: string }).cod).toBe('STANDARD-2200')

    // Scoaterea înălțimii rămâne o schimbare de măsuri, și tot refuzată.
    const faraInaltime = await app.inject({
      method: 'PATCH',
      url: `/modele/${modelId}/dimensiuni/${dimensiuneId}`,
      headers: antet('operator'),
      payload: { cod: 'STANDARD-2200', lungime: '2000', latime: '2200', inaltime: null },
    })
    expect(faraInaltime.statusCode).toBe(409)
  })
})
