import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

import { verificatorSupabase, type VerificatorToken } from './auth.js'
import { allowedOrigins, env } from './env.js'
import { inregistreazaTratareErori } from './erori.js'
import { ruteAuth } from './rute/auth.js'
import { ruteBonuri } from './rute/bonuri.js'
import { ruteConturi } from './rute/conturi.js'
import { ruteModele } from './rute/modele.js'
import { ruteNomenclator } from './rute/nomenclator.js'
import { ruteRetete } from './rute/retete.js'

export interface OptiuniApp {
  /** Overridden in tests so guards can be exercised without real Supabase tokens. */
  verificaToken?: VerificatorToken
}

export async function buildApp(optiuni: OptiuniApp = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      // Never let a key or token reach the logs.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  })

  await app.register(cors, { origin: allowedOrigins, credentials: true })
  // The nomenclature import is a file upload; nothing else in the API takes one.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
  inregistreazaTratareErori(app)

  const verifica = optiuni.verificaToken ?? verificatorSupabase

  // The only route without a role check. Everything else authenticates.
  app.get('/health', async () => ({ status: 'ok' }))

  ruteAuth(app, verifica)
  ruteConturi(app, verifica)
  ruteNomenclator(app, verifica)
  ruteModele(app, verifica)
  ruteRetete(app, verifica)
  ruteBonuri(app, verifica)

  return app
}
