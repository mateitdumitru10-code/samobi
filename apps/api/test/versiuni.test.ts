import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { clientSql } from '../src/db.js'
import { supabaseAdmin, supabaseAnon } from '../src/supabase.js'

import { areBazaDeDate } from './db.js'

/**
 * Versioning and approval, and the promise underneath them: a bon calculated in
 * July recalculates identically in August, whatever the recipe became.
 */

const marcaj = `V${Date.now().toString().slice(-8)}`
const parola = `Pw-${marcaj}-9xQ`
const conturi: Record<string, { id: string; token: string }> = {}

const MATERIAL = '00016024'
const PRODUS = '00022107'

let modelId = ''
let dimensiuneId = ''
let v1 = ''
const bonuri: string[] = []

async function creeazaCont(rol: string, sufix = '') {
  const email = `ver-${marcaj}-${rol}${sufix}@example.com`
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: parola,
    email_confirm: true,
    user_metadata: { nume: `Test ${rol}${sufix}`, rol },
  })
  if (error !== null || data.user === null) throw new Error(error?.message ?? 'cont necreat')

  const sesiune = await supabaseAnon.auth.signInWithPassword({ email, password: parola })
  if (sesiune.error !== null || sesiune.data.session === null) {
    throw new Error(sesiune.error?.message ?? 'sesiune necreată')
  }
  conturi[rol + sufix] = { id: data.user.id, token: sesiune.data.session.access_token }
}

function antet(rol: string) {
  return { authorization: `Bearer ${conturi[rol]?.token ?? ''}` }
}

describe.skipIf(!areBazaDeDate)('versionare și aprobare', () => {
  beforeAll(async () => {
    await creeazaCont('tehnolog')
    await creeazaCont('admin')
    // A second admin: the one who submits may not be the one who approves.
    await creeazaCont('admin', '2')

    const app = await buildApp()

    const creat = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('tehnolog'),
      payload: { cod: `TEST-${marcaj}`, denumire: 'Model versiuni', familie: 'PAT' },
    })
    modelId = (creat.json() as { id: string }).id

    const dim = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('tehnolog'),
      payload: {
        cod: '2000x1600',
        lungime: '2000',
        latime: '1600',
        inaltime: '350',
        codSagaProdus: PRODUS,
      },
    })
    dimensiuneId = (dim.json() as { id: string }).id

    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string; lockVersion: number }
    v1 = reteta.id

    await app.inject({
      method: 'PUT',
      url: `/retete/${v1}`,
      headers: antet('tehnolog'),
      payload: {
        lockVersion: reteta.lockVersion,
        linii: [
          {
            nrLinie: 1,
            grup: 'STRUCTURA',
            codSaga: MATERIAL,
            esteVariabil: false,
            um: 'MC',
            modCalcul: 'fixa',
            cantitateFixa: '0.04',
            procentPierderi: '0',
            valoriPeDimensiuni: [],
          },
        ],
      },
    })

    await app.close()
  }, 120_000)

  afterAll(async () => {
    if (modelId !== '') {
      await clientSql`delete from production_order_line where production_order_id in (
        select id from production_order where model_id = ${modelId})`
      await clientSql`delete from production_order where model_id = ${modelId}`
      await clientSql`delete from recipe_line where recipe_id in (
        select id from recipe where model_id = ${modelId})`
      await clientSql`delete from recipe where model_id = ${modelId}`
      await clientSql`delete from dimension where model_id = ${modelId}`
      await clientSql`delete from model where id = ${modelId} and cod like 'TEST-%'`
    }
    for (const cont of Object.values(conturi)) {
      await supabaseAdmin.auth.admin.deleteUser(cont.id)
    }
    await clientSql.end({ timeout: 5 })
  }, 120_000)

  it('nu trimite spre aprobare o rețetă goală', async () => {
    const app = await buildApp()
    const gol = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('tehnolog'),
      payload: { cod: `TEST-${marcaj}-GOL`, denumire: 'Model gol', familie: 'PAT' },
    })
    const idGol = (gol.json() as { id: string }).id
    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${idGol}/reteta`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string }

    const res = await app.inject({
      method: 'POST',
      url: `/retete/${reteta.id}/trimite-spre-aprobare`,
      headers: antet('tehnolog'),
    })
    expect(res.statusCode).toBe(400)

    await clientSql`delete from recipe where model_id = ${idGol}`
    await clientSql`delete from model where id = ${idGol} and cod like 'TEST-%'`
    await app.close()
  })

  it('un tehnolog nu poate aproba', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: `/retete/${v1}/trimite-spre-aprobare`,
      headers: antet('tehnolog'),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/retete/${v1}/aprobare`,
      headers: antet('tehnolog'),
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('nimeni nu își aprobă propria rețetă', async () => {
    const app = await buildApp()
    // Rețeta a fost creată de tehnolog; un admin care creează una nu o poate aproba.
    const creata = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('admin'),
      payload: { cod: `TEST-${marcaj}-PROPRIE`, denumire: 'Model propriu', familie: 'PAT' },
    })
    const idPropriu = (creata.json() as { id: string }).id
    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${idPropriu}/reteta`,
        headers: antet('admin'),
      })
    ).json() as { id: string; lockVersion: number }

    await app.inject({
      method: 'PUT',
      url: `/retete/${reteta.id}`,
      headers: antet('admin'),
      payload: {
        lockVersion: reteta.lockVersion,
        linii: [
          {
            nrLinie: 1,
            grup: 'STRUCTURA',
            codSaga: MATERIAL,
            esteVariabil: false,
            um: 'MC',
            modCalcul: 'fixa',
            cantitateFixa: '1',
            procentPierderi: '0',
            valoriPeDimensiuni: [],
          },
        ],
      },
    })
    await app.inject({
      method: 'POST',
      url: `/retete/${reteta.id}/trimite-spre-aprobare`,
      headers: antet('admin'),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/retete/${reteta.id}/aprobare`,
      headers: antet('admin'),
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/propria/i)

    await clientSql`delete from recipe_line where recipe_id = ${reteta.id}`
    await clientSql`delete from recipe where model_id = ${idPropriu}`
    await clientSql`delete from model where id = ${idPropriu} and cod like 'TEST-%'`
    await app.close()
  })

  it('adminul aprobă, iar rețeta devine activă și imutabilă', async () => {
    const app = await buildApp()

    const aprobare = await app.inject({
      method: 'POST',
      url: `/retete/${v1}/aprobare`,
      headers: antet('admin'),
    })
    expect(aprobare.statusCode).toBe(200)
    expect(aprobare.json()).toMatchObject({ status: 'activa' })

    const modificare = await app.inject({
      method: 'PUT',
      url: `/retete/${v1}`,
      headers: antet('tehnolog'),
      payload: { lockVersion: 1, linii: [] },
    })
    expect(modificare.statusCode).toBe(409)
    await app.close()
  })

  it('bonul se emite pe versiunea activă', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bonuri',
      headers: antet('tehnolog'),
      payload: {
        modelId,
        dimensiuneId,
        cantitate: '10',
        data: '2026-08-10',
        gestiuneProdus: 'MATERII PRIME',
        alegeri: {},
      },
    })
    expect(res.statusCode).toBe(201)

    const bon = res.json() as { id: string; recipeId: string; linii: { cantitateBruta: string }[] }
    bonuri.push(bon.id)
    expect(bon.recipeId).toBe(v1)
    // Citit din numeric(18,6), deci '0.400000'. Numărul contează, nu forma.
    expect(Number(bon.linii[0]?.cantitateBruta)).toBe(0.4)
    await app.close()
  })

  it('versiunea nouă se creează copiind-o pe cea activă', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/versiuni`,
      headers: antet('tehnolog'),
    })
    expect(res.statusCode).toBe(201)

    const noua = res.json() as { id: string; versiune: number; nrLinii: number; status: string }
    expect(noua.versiune).toBe(2)
    expect(noua.nrLinii).toBe(1)
    expect(noua.status).toBe('draft')

    // A second draft while one is open would leave nobody sure which is current.
    const dinNou = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/versiuni`,
      headers: antet('tehnolog'),
    })
    expect(dinNou.statusCode).toBe(409)
    await app.close()
  })

  it('bonul vechi se recalculează identic după ce rețeta se schimbă', async () => {
    const app = await buildApp()

    const versiuni = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/versiuni`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string; versiune: number; status: string }[]

    const v2 = versiuni.find((v) => v.versiune === 2)?.id ?? ''

    // Versiunea 2 dublează consumul și adaugă pierderi.
    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta?versiuneId=${v2}`,
        headers: antet('tehnolog'),
      })
    ).json() as { lockVersion: number }

    await app.inject({
      method: 'PUT',
      url: `/retete/${v2}`,
      headers: antet('tehnolog'),
      payload: {
        lockVersion: reteta.lockVersion,
        linii: [
          {
            nrLinie: 1,
            grup: 'STRUCTURA',
            codSaga: MATERIAL,
            esteVariabil: false,
            um: 'MC',
            modCalcul: 'fixa',
            cantitateFixa: '0.08',
            procentPierderi: '10',
            valoriPeDimensiuni: [],
          },
        ],
      },
    })
    await app.inject({
      method: 'POST',
      url: `/retete/${v2}/trimite-spre-aprobare`,
      headers: antet('tehnolog'),
    })
    const aprobare = await app.inject({
      method: 'POST',
      url: `/retete/${v2}/aprobare`,
      headers: antet('admin'),
    })
    expect(aprobare.statusCode).toBe(200)
    expect((aprobare.json() as { arhivate: number[] }).arhivate).toEqual([1])

    // Bonul de dinainte: aceleași linii, neatinse de schimbare.
    const bon = (
      await app.inject({
        method: 'GET',
        url: `/bonuri/${bonuri[0] ?? ''}`,
        headers: antet('tehnolog'),
      })
    ).json() as { recipeId: string; linii: { cantitateBruta: string }[] }

    expect(bon.recipeId).toBe(v1)
    // Citit din numeric(18,6), deci '0.400000'. Numărul contează, nu forma.
    expect(Number(bon.linii[0]?.cantitateBruta)).toBe(0.4)

    // Un bon nou, pe aceeași dimensiune și cantitate, dă acum altceva:
    // 0.08 × 10 × 1,10 = 0,88.
    const nou = await app.inject({
      method: 'POST',
      url: '/bonuri/previzualizare',
      headers: antet('tehnolog'),
      payload: { modelId, dimensiuneId, cantitate: '10', alegeri: {} },
    })
    expect((nou.json() as { linii: { cantitateBruta: string }[] }).linii[0]?.cantitateBruta).toBe(
      '0.88',
    )
    await app.close()
  })

  it('comparația arată exact ce s-a schimbat', async () => {
    const app = await buildApp()
    const versiuni = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/versiuni`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string; versiune: number }[]

    const v2 = versiuni.find((v) => v.versiune === 2)?.id ?? ''

    const res = await app.inject({
      method: 'GET',
      url: `/retete/${v2}/comparatie/${v1}`,
      headers: antet('tehnolog'),
    })
    expect(res.statusCode).toBe(200)

    const comparatie = res.json() as {
      rezumat: { modificate: number; adaugate: number; sterse: number }
      schimbari: { fel: string; campuri: { camp: string; inainte: string; dupa: string }[] }[]
    }
    expect(comparatie.rezumat).toMatchObject({ modificate: 1, adaugate: 0, sterse: 0 })

    const campuri = comparatie.schimbari[0]?.campuri.map((c) => c.camp) ?? []
    expect(campuri).toContain('cantitateFixa')
    expect(campuri).toContain('procentPierderi')
    await app.close()
  })

  it('respingerea trimite rețeta înapoi în lucru, cu motiv', async () => {
    const app = await buildApp()
    const creata = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/versiuni`,
      headers: antet('tehnolog'),
    })
    const v3 = (creata.json() as { id: string }).id

    await app.inject({
      method: 'POST',
      url: `/retete/${v3}/trimite-spre-aprobare`,
      headers: antet('tehnolog'),
    })

    const faraMotiv = await app.inject({
      method: 'POST',
      url: `/retete/${v3}/respingere`,
      headers: antet('admin'),
      payload: { motiv: 'nu' },
    })
    expect(faraMotiv.statusCode).toBe(400)

    const res = await app.inject({
      method: 'POST',
      url: `/retete/${v3}/respingere`,
      headers: antet('admin'),
      payload: { motiv: 'Cantitatea de cherestea nu corespunde fișei.' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'draft' })
    await app.close()
  })
})
