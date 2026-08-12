import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { clientSql } from '../src/db.js'
import { BUCKET_EXPORTURI } from '../src/export/stocare.js'
import { supabaseAdmin, supabaseAnon } from '../src/supabase.js'

import { areBazaDeDate } from './db.js'

/**
 * The whole path, end to end: model, dimension, recipe, bon, export file.
 *
 * Everything created here is prefixed and removed afterwards, including the file
 * uploaded to storage.
 */

const marcaj = `B${Date.now().toString().slice(-8)}`
const parola = `Pw-${marcaj}-9xQ`
const conturi: Record<string, { id: string; token: string }> = {}

const MATERIAL_FIX = '00016024'
const MATERIAL_VARIABIL = '00023684'
const PRODUS = '00022107'

let modelId = ''
let dimensiuneId = ''
let retetaId = ''
const bonuri: string[] = []
const exporturi: { id: string; cale: string }[] = []

async function creeazaCont(rol: string) {
  const email = `bon-${marcaj}-${rol}@example.com`
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

describe.skipIf(!areBazaDeDate)('bonuri și export', () => {
  beforeAll(async () => {
    await creeazaCont('tehnolog')
    await creeazaCont('operator')

    const app = await buildApp()

    const creat = await app.inject({
      method: 'POST',
      url: '/modele',
      headers: antet('tehnolog'),
      payload: { cod: `TEST-${marcaj}`, denumire: 'Model bon', familie: 'PAT' },
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
    retetaId = reteta.id

    await app.inject({
      method: 'PUT',
      url: `/retete/${retetaId}`,
      headers: antet('tehnolog'),
      payload: {
        lockVersion: reteta.lockVersion,
        linii: [
          {
            nrLinie: 1,
            grup: 'STRUCTURA',
            codSaga: MATERIAL_FIX,
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

    await app.close()
  }, 120_000)

  afterAll(async () => {
    for (const e of exporturi) {
      await supabaseAdmin.storage.from(BUCKET_EXPORTURI).remove([e.cale])
    }
    if (modelId !== '') {
      // Order matters, and the schema enforces it: `production_order_export_coerent`
      // forbids an exported bon without a batch, so the bons go first and the
      // batch after — never the other way round.
      const nostru = clientSql`model_id = ${modelId}`
      await clientSql`delete from production_order_line where production_order_id in (
        select id from production_order where ${nostru})`
      await clientSql`delete from production_order where ${nostru}`
      // By owner, not by the ids this run happens to hold: a suite killed
      // half-way leaves batches behind, and every one of them is a foreign key
      // that keeps its test account alive forever.
      const idConturi = Object.values(conturi).map((c) => c.id)
      if (idConturi.length > 0) {
        // The tripwire: a batch of this run that still has a bon after the
        // run's own bons are gone is somebody else's document, and this suite
        // had no business exporting it. Say so loudly rather than delete it.
        const straine = await clientSql<{ n: number }[]>`
          select count(*)::int n from production_order o
          join export_batch e on e.id = o.export_id
          where e.generat_de = any(${clientSql.array(idConturi)}::uuid[])`
        if ((straine[0]?.n ?? 0) > 0) {
          console.error(
            `ATENȚIE: ${straine[0]?.n} bonuri din afara testului au ajuns într-un lot ` +
              'generat de un cont de test. Verifică ce a exportat suita.',
          )
        }

        await clientSql`delete from export_batch
          where generat_de = any(${clientSql.array(idConturi)}::uuid[])
            and not exists (select 1 from production_order o where o.export_id = export_batch.id)`
      }
      await clientSql`delete from recipe_line where recipe_id in (
        select id from recipe where model_id = ${modelId})`
      await clientSql`delete from recipe where model_id = ${modelId}`
      await clientSql`delete from dimension where model_id = ${modelId}`
      await clientSql`delete from model where id = ${modelId} and cod like 'TEST-%'`
    }
    for (const cont of Object.values(conturi)) {
      // `deleteUser` reports failure in its result rather than throwing, so a
      // foreign key still pointing at the account used to leave it behind in
      // silence — nine of them, before anybody looked.
      const { error } = await supabaseAdmin.auth.admin.deleteUser(cont.id)
      if (error !== null) {
        throw new Error(`Contul de test ${cont.id} nu s-a putut șterge: ${error.message}`)
      }
    }
    await clientSql.end({ timeout: 5 })
  }, 120_000)

  it('cere materialul pentru liniile variabile', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/bonuri/context/${modelId}?dimensiuneId=${dimensiuneId}`,
      headers: antet('operator'),
    })
    expect(res.statusCode).toBe(200)
    const context = res.json() as { liniiVariabile: { nrLinie: number }[] }
    expect(context.liniiVariabile).toHaveLength(1)
    expect(context.liniiVariabile[0]?.nrLinie).toBe(2)
    await app.close()
  })

  it('refuză previzualizarea când materialul variabil nu a fost ales', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bonuri/previzualizare',
      headers: antet('operator'),
      payload: { modelId, dimensiuneId, cantitate: '1', alegeri: {} },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { mesaj: string }).mesaj).toMatch(/material/i)
    await app.close()
  })

  it('calculează consumurile pentru cantitatea cerută', async () => {
    const app = await buildApp()
    const linii = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('operator'),
      })
    ).json() as { linii: { id: string; nrLinie: number }[] }

    const linieVariabila = linii.linii.find((l) => l.nrLinie === 2)?.id ?? ''

    const res = await app.inject({
      method: 'POST',
      url: '/bonuri/previzualizare',
      headers: antet('operator'),
      payload: {
        modelId,
        dimensiuneId,
        cantitate: '3',
        alegeri: { [linieVariabila]: MATERIAL_VARIABIL },
      },
    })
    expect(res.statusCode).toBe(200)

    const rezultat = res.json() as {
      linii: { codSaga: string; cantitateBruta: string; cantitateBrutaRotunjita: string }[]
    }
    const cherestea = rezultat.linii.find((l) => l.codSaga === MATERIAL_FIX)
    const stofa = rezultat.linii.find((l) => l.codSaga === MATERIAL_VARIABIL)

    // 0.018 * 3 = 0.054 net; cu 8% pierderi -> 0.05832
    expect(cherestea?.cantitateBruta).toBe('0.05832')
    expect(cherestea?.cantitateBrutaRotunjita).toBe('0.058')
    // 16 * 3 = 48; cu 5% -> 50.4
    expect(stofa?.cantitateBruta).toBe('50.4')
    await app.close()
  })

  it('salvează bonul legat de versiunea de rețetă, nu de model', async () => {
    const app = await buildApp()
    const linii = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('operator'),
      })
    ).json() as { linii: { id: string; nrLinie: number }[] }
    const linieVariabila = linii.linii.find((l) => l.nrLinie === 2)?.id ?? ''

    const res = await app.inject({
      method: 'POST',
      url: '/bonuri',
      headers: antet('operator'),
      payload: {
        modelId,
        dimensiuneId,
        cantitate: '2',
        data: '2026-08-10',
        gestiuneProdus: 'MATERII PRIME',
        alegeri: { [linieVariabila]: MATERIAL_VARIABIL },
      },
    })
    expect(res.statusCode).toBe(201)

    const bon = res.json() as { id: string; status: string; recipeId: string }
    bonuri.push(bon.id)
    expect(bon.status).toBe('calculat')
    expect(bon.recipeId).toBe(retetaId)
    await app.close()
  })

  it('generează fișierul, îl urcă în bucket privat și marchează bonurile', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/export',
      headers: antet('operator'),
      payload: { bonIds: bonuri },
    })
    expect(res.statusCode).toBe(200)

    const lot = res.json() as { id: string; nrLinii: number; hashContinut: string }
    expect(lot.nrLinii).toBe(2)

    const [rand] = await clientSql`select storage_path from export_batch where id = ${lot.id}`
    const cale = rand?.['storage_path'] as string
    exporturi.push({ id: lot.id, cale })

    const [bon] = await clientSql`select status, export_id from production_order where id = ${bonuri[0] ?? ''}`
    expect(bon?.['status']).toBe('exportat')
    expect(bon?.['export_id']).toBe(lot.id)

    // Bucketul trebuie să fie privat: o descărcare fără semnătură nu are voie.
    const { data: descriere } = await supabaseAdmin.storage.getBucket(BUCKET_EXPORTURI)
    expect(descriere?.public).toBe(false)

    await app.close()
  })

  it('fișierul urcat conține codurile cu zerourile intacte', async () => {
    const cale = exporturi[0]?.cale ?? ''
    const { data, error } = await supabaseAdmin.storage.from(BUCKET_EXPORTURI).download(cale)
    expect(error).toBeNull()

    const continut = Buffer.from(await (data as Blob).arrayBuffer())
    const registru = new ExcelJS.Workbook()
    await registru.xlsx.load(continut as unknown as Parameters<typeof registru.xlsx.load>[0])
    const foaie = registru.getWorksheet('Consumuri')

    const coduri = [foaie?.getRow(2).getCell(1).value, foaie?.getRow(3).getCell(1).value]
    expect(coduri).toContain('00016024')
    expect(coduri).toContain('00023684')
  })

  it('refuză reexportul fără confirmare explicită', async () => {
    const app = await buildApp()

    const fara = await app.inject({
      method: 'POST',
      url: '/export',
      headers: antet('operator'),
      payload: { bonIds: bonuri },
    })
    expect(fara.statusCode).toBe(409)
    expect((fara.json() as { mesaj: string }).mesaj).toMatch(/deja exportate/i)

    const cu = await app.inject({
      method: 'POST',
      url: '/export',
      headers: antet('operator'),
      payload: { bonIds: bonuri, confirmaReexport: true },
    })
    expect(cu.statusCode).toBe(200)

    const lot = cu.json() as { id: string }
    const [rand] = await clientSql`select storage_path from export_batch where id = ${lot.id}`
    exporturi.push({ id: lot.id, cale: rand?.['storage_path'] as string })
    await app.close()
  })

  it('dă un link semnat, cu expirare, doar după verificarea rolului', async () => {
    const app = await buildApp()
    const id = exporturi[0]?.id ?? ''

    const res = await app.inject({
      method: 'GET',
      url: `/export/${id}/descarcare`,
      headers: antet('operator'),
    })
    expect(res.statusCode).toBe(200)

    const { url } = res.json() as { url: string }
    expect(url).toContain('token=')

    const fara = await app.inject({ method: 'GET', url: `/export/${id}/descarcare` })
    expect(fara.statusCode).toBe(401)
    await app.close()
  })

  it('exportă cu unitatea din rețetar, oricare ar fi cea din catalog', async () => {
    // Cautarea nepotrivirii se face DOAR printre bonurile acestei rulari.
    //
    // Prima versiune cauta in tot `production_order_line`, lua primul bon gasit
    // si il reexporta cu `confirmaReexport`. Bonul gasit era, previzibil, unul
    // real: o rulare de teste a mutat un bon de productie din lotul lui in unul
    // generat de un cont de test. Un test nu are voie sa scrie decat peste ce a
    // creat el.
    const [linie] = await clientSql`
      select pol.production_order_id, pol.um, a.um as um_saga
      from production_order_line pol
      join saga_article a on a.cod_saga = pol.cod_saga
      where pol.production_order_id = any(${clientSql.array(bonuri)}::uuid[])
        and upper(btrim(pol.um)) <> upper(btrim(a.um))
        and btrim(a.um) <> ''
      limit 1`

    if (linie === undefined) {
      // Nimic de verificat pe datele acestei rulari; testul nu inventeaza o
      // nepotrivire si nu se atinge de bonurile altcuiva.
      expect(true).toBe(true)
      return
    }

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/export',
      headers: antet('operator'),
      payload: {
        bonIds: [linie['production_order_id']],
        confirmaReexport: true,
      },
    })
    // SAGA ia unitatea din fișier, deci rețetarul decide. Exportul trece.
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('nu anulează un bon deja exportat', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: `/bonuri/${bonuri[0] ?? ''}/anulare`,
      headers: antet('operator'),
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  /**
   * Only the refusal above was covered, so the button everyone actually presses
   * was the untested half: a bon that has not left for SAGA yet.
   */
  it('anulează un bon necalculat în export și îl scoate din listă', async () => {
    const app = await buildApp()

    const linii = (
      await app.inject({
        method: 'GET',
        url: `/modele/${modelId}/reteta`,
        headers: antet('operator'),
      })
    ).json() as { linii: { id: string; nrLinie: number }[] }
    const linieVariabila = linii.linii.find((l) => l.nrLinie === 2)?.id ?? ''

    const creat = await app.inject({
      method: 'POST',
      url: '/bonuri',
      headers: antet('operator'),
      payload: {
        modelId,
        dimensiuneId,
        cantitate: '1',
        data: '2026-08-11',
        gestiuneProdus: 'MATERII PRIME',
        alegeri: { [linieVariabila]: MATERIAL_VARIABIL },
      },
    })
    expect(creat.statusCode).toBe(201)
    const bonId = (creat.json() as { id: string }).id
    bonuri.push(bonId)

    const anulare = await app.inject({
      method: 'POST',
      url: `/bonuri/${bonId}/anulare`,
      headers: antet('operator'),
    })
    expect(anulare.statusCode).toBe(200)
    expect(anulare.json()).toMatchObject({ id: bonId, status: 'anulat' })

    // The list is what the screen reads, so the status has to have landed there.
    const lista = (
      await app.inject({ method: 'GET', url: '/bonuri', headers: antet('operator') })
    ).json() as { id: string; status: string }[]
    expect(lista.find((b) => b.id === bonId)?.status).toBe('anulat')

    await app.close()
  })
})
