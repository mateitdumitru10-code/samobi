import postgres from 'postgres'

/**
 * Database tests run against the cloud project — there is no local stack.
 * Nothing may survive a test run, so every case executes inside a transaction
 * that is always rolled back.
 */

const url = process.env.DIRECT_URL ?? ''

/** True when a real Supabase connection string is configured. */
export const areBazaDeDate = url.includes('supabase.com')

export const sql = postgres(url, {
  ssl: 'require',
  prepare: false,
  max: 2,
  connect_timeout: 15,
  onnotice: () => {},
})

class Rollback extends Error {}

/**
 * Runs `fn` in a transaction and rolls it back, whatever happens. Assertions
 * that fail still roll back, because the rejection propagates through `begin`.
 */
export async function inTranzactie(fn: (tx: postgres.TransactionSql) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await fn(tx)
      throw new Rollback()
    })
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  }
}

/** Asserts that a statement is rejected by the database, and returns the error. */
export async function respinge(
  tx: postgres.TransactionSql,
  executa: () => Promise<unknown>,
): Promise<postgres.PostgresError> {
  // A failed statement poisons the transaction, so each attempt gets a
  // savepoint of its own and the rest of the test carries on.
  try {
    await tx.savepoint(async () => {
      await executa()
    })
  } catch (err) {
    return err as postgres.PostgresError
  }
  throw new Error('Baza de date a acceptat o valoare pe care trebuia să o respingă.')
}
