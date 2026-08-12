import { describe, expect, it } from 'vitest'

import { buildApp } from './app.js'

describe('health check', () => {
  it('raspunde cu status ok', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })

    await app.close()
  })
})

describe('CORS', () => {
  /**
   * Saving a recipe is a PUT and editing a model is a PATCH. Neither is a
   * CORS-safelisted method, so both live or die by this header: when it dropped
   * them, the browser refused the preflight and every save failed as a network
   * error, with a healthy API behind it.
   */
  it('acceptă metodele de scriere în preflight', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/retete/11111111-1111-1111-1111-111111111111',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,authorization',
      },
    })

    const metode = String(res.headers['access-control-allow-methods'] ?? '')
      .split(',')
      .map((m) => m.trim())

    expect(metode).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']))

    await app.close()
  })
})
