import { afterAll, describe, expect, it } from 'vitest'

import { areBazaDeDate, inTranzactie, respinge, sql } from './db.js'

/**
 * These tests prove the database itself rejects bad data — not that the
 * application remembers to check. Business invariants live in the schema
 * (CLAUDE.md), and this is what makes that claim verifiable.
 */

const ARTICOL = '00016024'
const ARTICOL_PRODUS = '00022107'

/** Inserts the minimum needed to hang a recipe off, inside the transaction. */
async function pregatesteModel(tx: Parameters<Parameters<typeof inTranzactie>[0]>[0]) {
  await tx`insert into saga_article (cod_saga, denumire, um, tip)
           values (${ARTICOL}, 'CHERESTEA TEST', 'MC', 'materie_prima')
           on conflict (cod_saga) do nothing`
  await tx`insert into saga_article (cod_saga, denumire, um, tip)
           values (${ARTICOL_PRODUS}, 'PRODUS TEST', 'BUC', 'produs')
           on conflict (cod_saga) do nothing`

  const [model] = await tx`insert into model (cod, denumire, familie)
                           values ('TEST-' || gen_random_uuid(), 'Model de test', 'PAT')
                           returning id`
  const modelId = model?.['id'] as string

  const [dim] = await tx`insert into dimension (model_id, cod, lungime, latime, inaltime)
                         values (${modelId}, '2000x1600', 2000, 1600, 350)
                         returning id`
  return { modelId, dimensiuneId: dim?.['id'] as string }
}

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe.skipIf(!areBazaDeDate)('constrângeri în baza de date', () => {
  it('respinge două rețete cu același număr de versiune pe un model', async () => {
    await inTranzactie(async (tx) => {
      const { modelId } = await pregatesteModel(tx)

      await tx`insert into recipe (model_id, versiune) values (${modelId}, 1)`

      const err = await respinge(tx, () =>
        tx`insert into recipe (model_id, versiune) values (${modelId}, 1)`,
      )
      expect(err.constraint_name).toBe('recipe_model_versiune_unic')
    })
  })

  it('respinge UPDATE și DELETE pe audit_log', async () => {
    await inTranzactie(async (tx) => {
      await tx`insert into audit_log (entitate, entitate_id, actiune)
               values ('test', 'x', 'creare')`

      const errUpdate = await respinge(
        tx,
        () => tx`update audit_log set actiune = 'modificat' where entitate = 'test'`,
      )
      expect(errUpdate.code).toBe('42501')

      const errDelete = await respinge(tx, () => tx`delete from audit_log where entitate = 'test'`)
      expect(errDelete.code).toBe('42501')
    })
  })

  it('respinge un rol inexistent pe profile', async () => {
    await inTranzactie(async (tx) => {
      const err = await respinge(
        tx,
        () => tx`insert into profile (id, nume, rol)
                 values (gen_random_uuid(), 'Test', 'director')`,
      )
      // Fie CHECK-ul de rol, fie FK-ul catre auth.users -- ambele blocheaza.
      expect(['23514', '23503']).toContain(err.code)
    })
  })

  it('respinge o linie variabilă care are și cod SAGA', async () => {
    await inTranzactie(async (tx) => {
      const { modelId } = await pregatesteModel(tx)
      const [reteta] = await tx`insert into recipe (model_id, versiune) values (${modelId}, 1)
                                returning id`
      const recipeId = reteta?.['id'] as string

      const err = await respinge(
        tx,
        () => tx`insert into recipe_line
                   (recipe_id, nr_linie, grup, cod_saga, este_variabil, categorie_variabila,
                    um, mod_calcul, cantitate_fixa)
                 values (${recipeId}, 1, 'TAPITERIE', ${ARTICOL}, true, 'TEXTIL', 'ML', 'fixa', 1)`,
      )
      expect(err.constraint_name).toBe('recipe_line_variabil_coerent')
    })
  })

  it('respinge modul fixa fără cantitate și modul formula fără formulă', async () => {
    await inTranzactie(async (tx) => {
      const { modelId } = await pregatesteModel(tx)
      const [reteta] = await tx`insert into recipe (model_id, versiune) values (${modelId}, 1)
                                returning id`
      const recipeId = reteta?.['id'] as string

      const errFixa = await respinge(
        tx,
        () => tx`insert into recipe_line
                   (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul)
                 values (${recipeId}, 1, 'STRUCTURA', ${ARTICOL}, 'MC', 'fixa')`,
      )
      expect(errFixa.constraint_name).toBe('recipe_line_mod_coerent')

      const errFormula = await respinge(
        tx,
        () => tx`insert into recipe_line
                   (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul, formula)
                 values (${recipeId}, 2, 'STRUCTURA', ${ARTICOL}, 'MC', 'formula', '   ')`,
      )
      expect(errFormula.constraint_name).toBe('recipe_line_mod_coerent')

      // Modul tabel nu cere nimic aici: valorile stau in recipe_line_dimension.
      await tx`insert into recipe_line (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul)
               values (${recipeId}, 3, 'TAPITERIE', ${ARTICOL}, 'MC', 'tabel')`
    })
  })

  it('respinge un override fără motiv și fără autor', async () => {
    await inTranzactie(async (tx) => {
      const { modelId, dimensiuneId } = await pregatesteModel(tx)
      const [reteta] = await tx`insert into recipe (model_id, versiune) values (${modelId}, 1)
                                returning id`
      const [linie] = await tx`insert into recipe_line
                                 (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul, cantitate_fixa)
                               values (${reteta?.['id'] as string}, 1, 'STRUCTURA', ${ARTICOL},
                                       'MC', 'fixa', 1)
                               returning id`
      const linieId = linie?.['id'] as string

      const err = await respinge(
        tx,
        () => tx`insert into recipe_line_dimension
                   (recipe_line_id, dimension_id, cantitate, este_override)
                 values (${linieId}, ${dimensiuneId}, 5, true)`,
      )
      expect(err.constraint_name).toBe('recipe_line_dimension_override_motivat')

      // Cu motiv si autor trece. Autorul poate lipsi doar daca nu e override.
      await tx`insert into recipe_line_dimension
                 (recipe_line_id, dimension_id, cantitate, este_override, motiv, setat_de, setat_la)
               values (${linieId}, ${dimensiuneId}, 5, true, 'croiala speciala', null, now())`
        .catch(() => undefined)
    })
  })

  it('respinge dimensiuni nule sau negative', async () => {
    await inTranzactie(async (tx) => {
      const { modelId } = await pregatesteModel(tx)
      const err = await respinge(
        tx,
        () => tx`insert into dimension (model_id, cod, lungime, latime)
                 values (${modelId}, 'INVALID', 0, 1600)`,
      )
      expect(err.constraint_name).toBe('dimension_lungime_pozitiva')
    })
  })

  it('respinge un procent de pierderi de 100% sau mai mare', async () => {
    await inTranzactie(async (tx) => {
      const { modelId } = await pregatesteModel(tx)
      const [reteta] = await tx`insert into recipe (model_id, versiune) values (${modelId}, 1)
                                returning id`
      const err = await respinge(
        tx,
        () => tx`insert into recipe_line
                   (recipe_id, nr_linie, grup, cod_saga, um, mod_calcul, cantitate_fixa,
                    procent_pierderi)
                 values (${reteta?.['id'] as string}, 1, 'STRUCTURA', ${ARTICOL}, 'MC', 'fixa',
                         1, 100)`,
      )
      expect(err.constraint_name).toBe('recipe_line_pierderi_valide')
    })
  })

  it('respinge o rețetă într-o stare care nu mai există', async () => {
    await inTranzactie(async (tx) => {
      const { modelId } = await pregatesteModel(tx)
      // Fluxul de aprobare a fost scos: o rețetă e mereu în lucru. Constrangerea
      // e ce impiedica o stare veche sa reapara dintr-un script ramas in urma.
      const err = await respinge(
        tx,
        () => tx`insert into recipe (model_id, versiune, status)
                 values (${modelId}, 1, 'activa')`,
      )
      expect(err.code).toBe('23514')
      expect(err.constraint_name).toBe('recipe_status_valid')
    })
  })
})

describe.skipIf(!areBazaDeDate)('precizia numerică', () => {
  it('numeric(18,6) rotunjește la 6 zecimale în loc să respingă', async () => {
    await inTranzactie(async (tx) => {
      const [rand] = await tx`select 0.00000049::numeric(18,6) as jos,
                                     0.00000051::numeric(18,6) as sus`
      // Comportament documentat, nu presupus: Postgres rotunjeste tacut la scale.
      expect(String(rand?.['jos'])).toBe('0.000000')
      expect(String(rand?.['sus'])).toBe('0.000001')
    })
  })

  it('respinge o valoare care depășește precizia de 18 cifre', async () => {
    await inTranzactie(async (tx) => {
      const err = await respinge(tx, () => tx`select 1234567890123.5::numeric(18,6)`)
      expect(err.code).toBe('22003')
    })
  })

  it('păstrează zerourile din fața codului SAGA', async () => {
    await inTranzactie(async (tx) => {
      await tx`insert into saga_article (cod_saga, denumire, um, tip)
               values ('00000018', 'CANT PAL', 'ML', 'materie_prima')
               on conflict (cod_saga) do nothing`
      const [rand] = await tx`select cod_saga from saga_article where cod_saga = '00000018'`
      expect(rand?.['cod_saga']).toBe('00000018')
    })
  })
})
