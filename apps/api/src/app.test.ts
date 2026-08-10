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
