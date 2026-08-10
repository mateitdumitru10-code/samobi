import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { clientSql } from '../src/db.js'
import { supabaseAdmin, supabaseAnon } from '../src/supabase.js'

import { areBazaDeDate } from './db.js'

/**
 * The mapping queue: resolving a name, and taking it back.
 *
 * The undo is the part worth testing. It deletes recipe lines, so it has to
 * remove exactly the ones its own mapping created and nothing that anybody
 * touched afterwards — the difference between an undo and losing somebody's
 * work is entirely in that condition.
 */

const marcaj = `T${Date.now().toString().slice(-8)}`
const parola = `Pw-${marcaj}-4kL`
const conturi: Record<string, { id: string; token: string }> = {}
const modeleCreate: string[] = []
const nemapateCreate: string[] = []

const ARTICOL_MATERIAL = '00016024'

async function creeazaCont(rol: string) {
  const email = `coada-${marcaj}-${rol}@example.com`
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

describe.skipIf(!areBazaDeDate)('coada de materiale nemapate', () => {
  beforeAll(async () => {
    await creeazaCont('tehnolog')
  }, 60_000)

  afterAll(async () => {
    if (nemapateCreate.length > 0) {
      await clientSql`delete from unmapped_material
        where id = any(${clientSql.array(nemapateCreate)}::uuid[])
          and denumire_externa like ${'TEST-%'}`
    }
    if (modeleCreate.length > 0) {
      // Two conditions, as everywhere in this suite: the ids are what the run
      // created, the code prefix is the seatbelt against the real project.
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

  /** A draft recipe with a queued material waiting on line 1. */
  async function pregateste(sufix: string, denumire: string) {
    const app = await buildApp()

    const model = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('tehnolog'),
      payload: {
        cod: `TEST-${marcaj}-${sufix.toUpperCase()}`,
        denumire: `Model coadă ${sufix}`,
        familie: 'PAT',
      },
    })
    const modelId = (model.json() as { id: string }).id
    modeleCreate.push(modelId)

    const [reteta] = await clientSql<{ id: string }[]>`
      insert into recipe (model_id, versiune, status) values (${modelId}, 1, 'draft')
      returning id`
    const recipeId = reteta?.id ?? ''

    const [material] = await clientSql<{ id: string }[]>`
      insert into unmapped_material (denumire_externa) values (${denumire}) returning id`
    const materialId = material?.id ?? ''
    nemapateCreate.push(materialId)

    await clientSql`
      insert into unmapped_material_ocurenta
        (unmapped_material_id, recipe_id, nr_linie, grup, um, cantitate)
      values (${materialId}, ${recipeId}, 1, 'STRUCTURA', 'BUC', 2)`

    return { app, materialId, recipeId }
  }

  it('rezolvarea completează rețeta, iar anularea o desface la loc', async () => {
    const { app, materialId, recipeId } = await pregateste(
      'undo',
      `TEST-${marcaj}-MATERIAL-UNDO`,
    )

    const rezolvare = await app.inject({
      method: 'POST',
      url: `/nomenclator/nemapate/${materialId}/rezolvare`,
      headers: antet('tehnolog'),
      payload: { codSaga: ARTICOL_MATERIAL },
    })
    expect(rezolvare.statusCode).toBe(200)
    expect(rezolvare.json()).toMatchObject({ linii: 1, sarite: 0 })

    const dupaRezolvare = await clientSql<{ n: number }[]>`
      select count(*)::int n from recipe_line where recipe_id = ${recipeId}`
    expect(dupaRezolvare[0]?.n).toBe(1)

    const anulare = await app.inject({
      method: 'POST',
      url: `/nomenclator/nemapate/${materialId}/anulare`,
      headers: antet('tehnolog'),
    })
    expect(anulare.statusCode).toBe(200)
    expect(anulare.json()).toMatchObject({ liniiSterse: 1, liniiPastrate: 0 })

    const dupaAnulare = await clientSql<{ n: number }[]>`
      select count(*)::int n from recipe_line where recipe_id = ${recipeId}`
    expect(dupaAnulare[0]?.n).toBe(0)

    // Back in the queue, and offered again on the next load.
    const coada = await app.inject({
      method: 'GET',
      url: '/nomenclator/nemapate',
      headers: antet('tehnolog'),
    })
    const intrari = coada.json() as { id: string }[]
    expect(intrari.some((i) => i.id === materialId)).toBe(true)

    await app.close()
  })

  it('anularea nu atinge o linie modificată după mapare', async () => {
    const { app, materialId, recipeId } = await pregateste(
      'pastrat',
      `TEST-${marcaj}-MATERIAL-PASTRAT`,
    )

    await app.inject({
      method: 'POST',
      url: `/nomenclator/nemapate/${materialId}/rezolvare`,
      headers: antet('tehnolog'),
      payload: { codSaga: ARTICOL_MATERIAL },
    })

    // Somebody edited the line afterwards; the note the mapping wrote is gone.
    await clientSql`
      update recipe_line set observatii = 'schimbat de tehnolog' where recipe_id = ${recipeId}`

    const anulare = await app.inject({
      method: 'POST',
      url: `/nomenclator/nemapate/${materialId}/anulare`,
      headers: antet('tehnolog'),
    })
    expect(anulare.statusCode).toBe(200)
    expect(anulare.json()).toMatchObject({ liniiSterse: 0, liniiPastrate: 1 })

    const ramase = await clientSql<{ n: number }[]>`
      select count(*)::int n from recipe_line where recipe_id = ${recipeId}`
    expect(ramase[0]?.n).toBe(1)

    await app.close()
  })

  it('amânarea scoate intrarea din fluxul principal fără s-o rezolve', async () => {
    const { app, materialId } = await pregateste('amanat', `TEST-${marcaj}-MATERIAL-AMANAT`)

    const amanare = await app.inject({
      method: 'POST',
      url: `/nomenclator/nemapate/${materialId}/amanare`,
      headers: antet('tehnolog'),
      payload: { amanat: true },
    })
    expect(amanare.statusCode).toBe(200)

    const coada = await app.inject({
      method: 'GET',
      url: '/nomenclator/nemapate',
      headers: antet('tehnolog'),
    })
    const intrare = (coada.json() as { id: string; amanat: boolean }[]).find(
      (i) => i.id === materialId,
    )
    expect(intrare?.amanat).toBe(true)

    await app.close()
  })

  it('refuză anularea unei intrări nerezolvate', async () => {
    const { app, materialId } = await pregateste('nerez', `TEST-${marcaj}-MATERIAL-NEREZ`)

    const anulare = await app.inject({
      method: 'POST',
      url: `/nomenclator/nemapate/${materialId}/anulare`,
      headers: antet('tehnolog'),
    })
    expect(anulare.statusCode).toBe(400)

    await app.close()
  })
})
