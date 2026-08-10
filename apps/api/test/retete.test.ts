import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { clientSql } from '../src/db.js'
import { supabaseAdmin, supabaseAnon } from '../src/supabase.js'

import { areBazaDeDate } from './db.js'

/**
 * Models, dimensions and the recipe grid, against the real project.
 *
 * Everything created here carries a run-specific code and is removed afterwards.
 * Audit rows stay, because audit_log is append-only by design.
 */

const marcaj = `T${Date.now().toString().slice(-8)}`
const parola = `Pw-${marcaj}-9xQ`
const conturi: Record<string, { id: string; token: string }> = {}
const modeleCreate: string[] = []

const ARTICOL_MATERIAL = '00016024'
const ARTICOL_PRODUS = '00022107'

async function creeazaCont(rol: string) {
  const email = `retete-${marcaj}-${rol}@example.com`
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

describe.skipIf(!areBazaDeDate)('modele, dimensiuni și rețetar', () => {
  beforeAll(async () => {
    await creeazaCont('tehnolog')
    await creeazaCont('operator')
  }, 60_000)

  afterAll(async () => {
    if (modeleCreate.length > 0) {
      // Two conditions, not one. The ids are what the run created; the code
      // prefix is the seatbelt. These tests run against the production project,
      // so a mistake here would delete somebody's real work.
      const ale_noastre = clientSql`
        id = any(${clientSql.array(modeleCreate)}::uuid[]) and cod like 'TEST-%'`

      await clientSql`delete from recipe_line where recipe_id in (
        select id from recipe where model_id in (select id from model where ${ale_noastre}))`
      await clientSql`delete from recipe where model_id in (select id from model where ${ale_noastre})`
      await clientSql`delete from dimension where model_id in (select id from model where ${ale_noastre})`
      await clientSql`delete from model where ${ale_noastre}`
    }
    for (const cont of Object.values(conturi)) {
      await supabaseAdmin.auth.admin.deleteUser(cont.id)
    }
    await clientSql.end({ timeout: 5 })
  }, 60_000)

  async function creeazaModel(app: Awaited<ReturnType<typeof buildApp>>, sufix: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('tehnolog'),
      payload: {
        cod: `TEST-${marcaj}-${sufix.toUpperCase()}`,
        denumire: `Model test ${sufix}`,
        familie: 'PAT',
      },
    })
    expect(res.statusCode).toBe(201)
    const creat = res.json() as { id: string }
    modeleCreate.push(creat.id)
    return creat.id
  }

  it('creează un model și refuză un cod duplicat', async () => {
    const app = await buildApp()
    const id = await creeazaModel(app, 'dup')
    expect(id).toBeTruthy()

    const duplicat = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('tehnolog'),
      payload: { cod: `TEST-${marcaj}-DUP`, denumire: 'Alt model', familie: 'CANAPEA' },
    })
    expect(duplicat.statusCode).toBe(409)
    await app.close()
  })

  it('refuză un cod de produs care nu este produs finit în SAGA', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'prod')

    const gresit = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('tehnolog'),
      // Cherestea este materie primă, nu produs finit.
      payload: { cod: '2000x1600', lungime: '2000', latime: '1600', codSagaProdus: ARTICOL_MATERIAL },
    })
    expect(gresit.statusCode).toBe(400)
    expect((gresit.json() as { mesaj: string }).mesaj).toMatch(/nu este produs finit/i)

    const bun = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('tehnolog'),
      payload: { cod: '2000x1600', lungime: '2000', latime: '1600', inaltime: '350', codSagaProdus: ARTICOL_PRODUS },
    })
    expect(bun.statusCode).toBe(201)
    await app.close()
  })

  it('respinge dimensiuni scrise în metri în loc de milimetri', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'mm')

    const res = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('tehnolog'),
      payload: { cod: '2x1.6', lungime: '2', latime: '1.6' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).toMatch(/milimetri/i)
    await app.close()
  })

  it('creează o rețetă goală la prima deschidere', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'goala')

    const res = await app.inject({
      method: 'GET',
      url: `/modele/${modelId}/reteta`,
      headers: antet('tehnolog'),
    })
    expect(res.statusCode).toBe(200)
    const reteta = res.json() as { status: string; lockVersion: number; linii: unknown[] }
    expect(reteta.status).toBe('draft')
    expect(reteta.lockVersion).toBe(0)
    expect(reteta.linii).toHaveLength(0)
    await app.close()
  })

  it('salvează liniile și incrementează lock_version', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'salvare')

    await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('tehnolog'),
      payload: { cod: '2000x1600', lungime: '2000', latime: '1600', inaltime: '350' },
    })

    const initiala = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string; lockVersion: number; dimensiuni: { id: string }[] }

    const dimensiuneId = initiala.dimensiuni[0]?.id ?? ''

    const salvare = await app.inject({
      method: 'PUT',
      url: `/retete/${initiala.id}`,
      headers: antet('tehnolog'),
      payload: {
        lockVersion: initiala.lockVersion,
        linii: [
          {
            nrLinie: 1,
            grup: 'STRUCTURA',
            codSaga: ARTICOL_MATERIAL,
            esteVariabil: false,
            um: 'MC',
            modCalcul: 'formula',
            formula: '2*(L+l)/1000 * 0.10 * 0.025',
            procentPierderi: '8',
            valoriPeDimensiuni: [],
          },
          {
            nrLinie: 2,
            grup: 'TAPITERIE',
            codSaga: null,
            esteVariabil: true,
            categorieVariabila: 'TEXTIL',
            um: 'ML',
            modCalcul: 'tabel',
            procentPierderi: '5',
            valoriPeDimensiuni: [{ dimensiuneId, cantitate: '16', esteOverride: false }],
          },
        ],
      },
    })
    expect(salvare.statusCode).toBe(200)
    expect((salvare.json() as { lockVersion: number }).lockVersion).toBe(initiala.lockVersion + 1)

    const dupa = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('tehnolog'),
      })
    ).json() as { linii: { nrLinie: number; valoriPeDimensiuni: unknown[] }[] }
    expect(dupa.linii).toHaveLength(2)
    expect(dupa.linii[1]?.valoriPeDimensiuni).toHaveLength(1)
    await app.close()
  })

  it('răspunde 409 când altcineva a salvat între timp', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'conflict')

    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string; lockVersion: number }

    const corp = {
      lockVersion: reteta.lockVersion,
      linii: [
        {
          nrLinie: 1,
          grup: 'STRUCTURA',
          codSaga: ARTICOL_MATERIAL,
          esteVariabil: false,
          um: 'MC',
          modCalcul: 'fixa',
          cantitateFixa: '0.04',
          procentPierderi: '0',
          valoriPeDimensiuni: [],
        },
      ],
    }

    const prima = await app.inject({
      method: 'PUT',
      url: `/retete/${reteta.id}`,
      headers: antet('tehnolog'),
      payload: corp,
    })
    expect(prima.statusCode).toBe(200)

    // Aceeași versiune, trimisă a doua oară: exact ce face al doilea tehnolog
    // care avea pagina deschisă.
    const adoua = await app.inject({
      method: 'PUT',
      url: `/retete/${reteta.id}`,
      headers: antet('tehnolog'),
      payload: corp,
    })
    expect(adoua.statusCode).toBe(409)
    expect((adoua.json() as { mesaj: string }).mesaj).toMatch(/reîncarcă/i)
    await app.close()
  })

  it('respinge o linie cu cod care nu există în nomenclator', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'codlipsa')
    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string; lockVersion: number }

    const res = await app.inject({
      method: 'PUT',
      url: `/retete/${reteta.id}`,
      headers: antet('tehnolog'),
      payload: {
        lockVersion: reteta.lockVersion,
        linii: [
          {
            nrLinie: 1,
            grup: 'STRUCTURA',
            codSaga: '99999999',
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
    expect(res.statusCode).toBe(400)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/nomenclator/i)
    await app.close()
  })

  it('respinge o linie cu articol fără unitate de măsură', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'umlipsa')
    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('tehnolog'),
      })
    ).json() as { id: string; lockVersion: number }

    // 00000662 CUIE există în nomenclator, dar are UM gol. SAGA respinge linia
    // la import și spune doar că articolul e greșit, nu de ce.
    const res = await app.inject({
      method: 'PUT',
      url: `/retete/${reteta.id}`,
      headers: antet('tehnolog'),
      payload: {
        lockVersion: reteta.lockVersion,
        linii: [
          {
            nrLinie: 1,
            grup: 'ACCESORII',
            codSaga: '00000662',
            esteVariabil: false,
            um: 'MIIB',
            modCalcul: 'fixa',
            cantitateFixa: '0.05',
            procentPierderi: '0',
            valoriPeDimensiuni: [],
          },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/unitate de măsură/i)
    await app.close()
  })

  it('un operator nu poate modifica rețeta', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'rol')
    const reteta = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('operator'),
      })
    ).json() as { id: string; lockVersion: number }

    const res = await app.inject({
      method: 'PUT',
      url: `/retete/${reteta.id}`,
      headers: antet('operator'),
      payload: { lockVersion: reteta.lockVersion, linii: [] },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('validează formula și arată rezultatul pe o dimensiune', async () => {
    const app = await buildApp()
    const modelId = await creeazaModel(app, 'formula')
    const creata = await app.inject({
      method: 'POST',
      url: `/modele/${modelId}/dimensiuni`,
      headers: antet('tehnolog'),
      payload: { cod: '2000x1600', lungime: '2000', latime: '1600', inaltime: '350' },
    })
    const dimensiuneId = (creata.json() as { id: string }).id

    const buna = await app.inject({
      method: 'POST',
      url: '/retete/valideaza-formula',
      headers: antet('tehnolog'),
      payload: { formula: '2*(L+l)/1000 * 0.10 * 0.025', dimensiuneId },
    })
    expect(buna.json()).toMatchObject({
      valida: true,
      previzualizare: { dimensiune: '2000x1600', valoare: '0.018' },
    })

    const necunoscuta = await app.inject({
      method: 'POST',
      url: '/retete/valideaza-formula',
      headers: antet('tehnolog'),
      payload: { formula: 'X*2' },
    })
    expect(necunoscuta.json()).toMatchObject({ valida: false })
    expect((necunoscuta.json() as { mesaj: string }).mesaj).toMatch(/L, l/)

    const interzisa = await app.inject({
      method: 'POST',
      url: '/retete/valideaza-formula',
      headers: antet('tehnolog'),
      payload: { formula: 'sin(L)' },
    })
    expect(interzisa.json()).toMatchObject({ valida: false })
    await app.close()
  })
})
