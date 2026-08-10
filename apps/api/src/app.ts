import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

import { allowedOrigins, env } from './env.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      // Never let a key or token reach the logs.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  })

  await app.register(cors, { origin: allowedOrigins, credentials: true })

  // The only route without a role check. Everything else authenticates.
  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
