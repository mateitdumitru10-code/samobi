import * as schema from '@samobi/shared/db'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from './env.js'

/**
 * Runtime connection: the transaction-mode pooler.
 *
 * `prepare: false` is mandatory — the transaction pooler hands each statement to
 * whichever backend is free, so prepared statements never survive to be reused.
 * Migrations use DIRECT_URL instead; see CLAUDE.md, "Conexiuni".
 */
export const clientSql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 15,
  onnotice: () => {},
})

export const db = drizzle(clientSql, { schema })

export type Db = typeof db
