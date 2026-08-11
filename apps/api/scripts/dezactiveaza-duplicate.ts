import { model, recipe, unmappedMaterial, unmappedMaterialOcurenta } from '@samobi/shared/db'
import { inArray, notInArray, sql } from 'drizzle-orm'

import { clientSql, db } from '../src/db.js'

/**
 * Retires the models transcribed from paper sheets under a short code, in
 * favour of the same product as SAGA's own production reports have it.
 *
 * „CL SORIA" and „COLTAR SORIA" are one coltar. The first was typed off a
 * workshop sheet, with generic articles („ADEZIV", „CUIE") that never matched
 * the catalogue and no finished-product code, so it cannot issue a bon at all;
 * the second came out of nineteen months of real production, names the article
 * the workshop actually consumes, and is ready to use.
 *
 * Deactivation, not deletion: nothing is lost, the recipe stays behind the
 * model, and one UPDATE brings it back. The queue entries do go — a material
 * waiting to be mapped onto a retired model is work nobody should be asked to
 * do.
 *
 *   pnpm --filter @samobi/api dezactiveaza-duplicate
 *   pnpm --filter @samobi/api dezactiveaza-duplicate -- --scrie
 */

const scrie = process.argv.slice(2).includes('--scrie')

/** The sheet code, and the full-named model that replaces it. */
const PERECHI: readonly (readonly [string, string])[] = [
  ['CL-ECO', 'COLTAR-ECO'],
  ['CL-SORIA', 'COLTAR-SORIA'],
  ['CL-VISION', 'COLTAR-VISION'],
  ['CL-ROBERT-7-PIESE', 'COLTAR-ROBERT-7-PIESE'],
  // The only other COLTAR ROBERT is the seven-piece, which is taken above.
  ['CL-ROBERT', 'COLTAR-ROBERT-5-PIESE'],
  ['C3-SORIA', 'CANAPEA-SORIA'],
]

interface Rand {
  cod: string
  denumire: string
  activ: boolean
  linii: number
  bonuri: number
  ocurente: number
  dim_cu_produs: number
  din_saga: number
}

const stare = async (coduri: readonly string[]) =>
  clientSql<Rand[]>`
    select m.cod, m.denumire, m.activ,
      (select count(*) from recipe r join recipe_line rl on rl.recipe_id = r.id
        where r.model_id = m.id)::int as linii,
      (select count(*) from recipe r join recipe_line rl on rl.recipe_id = r.id
        where r.model_id = m.id and rl.observatii like 'din SAGA%')::int as din_saga,
      (select count(*) from production_order p where p.model_id = m.id)::int as bonuri,
      (select count(*) from unmapped_material_ocurenta o join recipe r on r.id = o.recipe_id
        where r.model_id = m.id and not o.aplicat)::int as ocurente,
      (select count(*) from dimension d where d.model_id = m.id and d.activ
        and d.cod_saga_produs is not null)::int as dim_cu_produs
    from model m where m.cod in ${clientSql([...coduri])}
    order by m.cod`

const deRetras = await stare(PERECHI.map(([vechi]) => vechi))
const inlocuitori = new Map((await stare(PERECHI.map(([, nou]) => nou))).map((r) => [r.cod, r]))

console.log('\nModele de retras, și ce le ia locul:\n')

const oprite: string[] = []
for (const [vechi, nou] of PERECHI) {
  const a = deRetras.find((r) => r.cod === vechi)
  const b = inlocuitori.get(nou)

  if (a === undefined) {
    console.log(`  ${vechi.padEnd(28)} nu există — sărit`)
    continue
  }
  if (!a.activ) {
    console.log(`  ${vechi.padEnd(28)} deja inactiv`)
    continue
  }
  // A bon pins the model it was issued against. Retiring one that has been used
  // would leave a document pointing at something the screens no longer show.
  if (a.bonuri > 0) {
    console.log(`  ${vechi.padEnd(28)} ARE ${a.bonuri} bonuri — nu se atinge`)
    oprite.push(vechi)
    continue
  }
  if (b === undefined || !b.activ) {
    console.log(`  ${vechi.padEnd(28)} înlocuitorul ${nou} lipsește sau e inactiv — sărit`)
    oprite.push(vechi)
    continue
  }
  if (b.din_saga === 0) {
    console.log(`  ${vechi.padEnd(28)} ${nou} nu are rețetă din SAGA — sărit`)
    oprite.push(vechi)
    continue
  }

  console.log(
    `  ${vechi.padEnd(28)} ${String(a.linii).padStart(2)} linii, ${String(a.ocurente).padStart(2)} nemapate` +
      `   →   ${nou.padEnd(24)} ${b.linii} linii din SAGA, produs finit legat`,
  )
}

const deAplicat = PERECHI.map(([vechi]) => vechi).filter(
  (cod) => !oprite.includes(cod) && deRetras.find((r) => r.cod === cod)?.activ === true,
)

if (deAplicat.length === 0 || !scrie) {
  console.log(`\n${deAplicat.length} de retras. Nimic scris. Rulează din nou cu --scrie.`)
  await clientSql.end({ timeout: 5 })
  process.exit(0)
}

const rezultat = await db.transaction(async (tx) => {
  const ids = (
    await tx.select({ id: model.id }).from(model).where(inArray(model.cod, deAplicat))
  ).map((m) => m.id)

  const retete = (
    await tx.select({ id: recipe.id }).from(recipe).where(inArray(recipe.modelId, ids))
  ).map((r) => r.id)

  const ocurente =
    retete.length === 0
      ? []
      : await tx
          .delete(unmappedMaterialOcurenta)
          .where(inArray(unmappedMaterialOcurenta.recipeId, retete))
          .returning({ id: unmappedMaterialOcurenta.id })

  // A queue entry with nowhere left to apply is not a decision anyone can make.
  const orfane = await tx
    .delete(unmappedMaterial)
    .where(
      sql`${unmappedMaterial.rezolvat} = false and ${notInArray(
        unmappedMaterial.id,
        db.selectDistinct({ id: unmappedMaterialOcurenta.unmappedMaterialId }).from(
          unmappedMaterialOcurenta,
        ),
      )}`,
    )
    .returning({ denumire: unmappedMaterial.denumireExterna })

  await tx.update(model).set({ activ: false }).where(inArray(model.id, ids))

  return { modele: ids.length, ocurente: ocurente.length, orfane: orfane.length }
})

console.log(
  `\n${rezultat.modele} modele dezactivate, ${rezultat.ocurente} ocurențe scoase din coadă, ` +
    `${rezultat.orfane} materiale rămase fără nicio apariție șterse din coadă.`,
)
console.log('Rețetele rămân în bază. Reactivarea e un update pe model.activ.')

await clientSql.end({ timeout: 10 })
