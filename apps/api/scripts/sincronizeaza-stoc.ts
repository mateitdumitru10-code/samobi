import { clientSql } from '../src/db.js'
import { sincronizeazaStocul } from '../src/stoc/sincronizare.js'

/**
 * Reads SAGA's stock and replaces the local snapshot.
 *
 *   pnpm --filter @samobi/api sincronizeaza-stoc
 *
 * One reading costs 22 MB and about fifteen seconds whatever period is asked
 * for, and every call to SAGA is another chance for a missed key rotation to
 * block the integration. Run it on a rhythm, not in a loop.
 */

const raport = await sincronizeazaStocul()

console.log(`Citit din SAGA în ${(raport.durataMs / 1000).toFixed(1)}s.`)
console.log(`${raport.randuri} rânduri, ${raport.articole} articole păstrate.`)

if (raport.necunoscute > 0) {
  console.log(
    `${raport.necunoscute} coduri există în SAGA dar nu în nomenclator, deci au fost sărite ` +
      `(${raport.necunoscuteExemple.join(', ')}${raport.necunoscute > 5 ? ', …' : ''}). ` +
      'Importă nomenclatorul dacă sunt materiale care te interesează.',
  )
}

console.log(`${raport.epuizate} materiale folosite în rețete sunt pe zero sau sub zero.`)

await clientSql.end()
