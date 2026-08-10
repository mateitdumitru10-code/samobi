import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

import { verificatorSupabase, type VerificatorToken } from './auth.js'
import { allowedOrigins, env } from './env.js'
import { inregistreazaTratareErori } from './erori.js'
import { ruteAuth } from './rute/auth.js'
import { ruteConturi } from './rute/conturi.js'

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
  inregistreazaTratareErori(app)

  const verifica = optiuni.verificaToken ?? verificatorSupabase

  // The only route without a role check. Everything else authenticates.
  app.get('/health', async () => ({ status: 'ok' }))

  ruteAuth(app, verifica)
  ruteConturi(app, verifica)

  return app
}
