import { auditLog } from '@samobi/shared/db'
import type { FastifyRequest } from 'fastify'

import { db } from './db.js'

export type Actiune =
  | 'login'
  | 'login_esuat'
  | 'logout'
  | 'creare_cont'
  | 'schimbare_rol'
  | 'dezactivare_cont'
  | 'reactivare_cont'

export interface IntrareAudit {
  userId?: string | null
  entitate: string
  entitateId: string
  actiune: Actiune
  diff?: unknown
}

/** The client IP, respecting the proxy header the hosting platform sets. */
function ipCerere(cerere: FastifyRequest): string | null {
  const inaintat = cerere.headers['x-forwarded-for']
  const brut = Array.isArray(inaintat) ? inaintat[0] : (inaintat ?? cerere.ip)
  const primul = brut?.split(',')[0]?.trim()
  return primul !== undefined && primul !== '' ? primul : null
}

/**
 * Writes one audit row.
 *
 * Never throws: an audit failure must not roll back the action it describes, but
 * it must be loud in the logs. The table is append-only in the database, so a
 * row written here cannot be altered later.
 */
export async function scrieAudit(cerere: FastifyRequest, intrare: IntrareAudit): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: intrare.userId ?? null,
      entitate: intrare.entitate,
      entitateId: intrare.entitateId,
      actiune: intrare.actiune,
      diff: intrare.diff === undefined ? null : intrare.diff,
      ip: ipCerere(cerere),
    })
  } catch (err) {
    cerere.log.error({ err, intrare }, 'nu am putut scrie in audit_log')
  }
}
