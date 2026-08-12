import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { cifreaza, descifreaza } from './cheie.js'

/**
 * The encryption is tested here; the lease is not, deliberately.
 *
 * `saga_credential` holds exactly one row by constraint, and this project runs
 * its tests against the same cloud database production uses. A test that seeded
 * or rotated that row would destroy the live SAGA key, and the only recovery is
 * a human generating a new one in SAGA WEB. The lease was exercised end to end
 * by hand while the table was still empty — see the notes in `cheie.ts`.
 */

const CHEIE = randomBytes(32)

describe('cifrarea cheii SAGA', () => {
  it('se întoarce la valoarea inițială', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.acesta-e-un-token-lung-ca-al-lor'
    expect(descifreaza(cifreaza(token, CHEIE), CHEIE)).toBe(token)
  })

  it('produce alt text cifrat la fiecare apel', () => {
    // A fresh IV every time: two identical keys must not produce identical rows,
    // otherwise anyone reading the table learns when the key did not change.
    const token = 'acelasi-token'
    expect(cifreaza(token, CHEIE)).not.toBe(cifreaza(token, CHEIE))
  })

  it('respinge un rând modificat în bază', () => {
    const pachet = Buffer.from(cifreaza('token', CHEIE), 'base64')
    // Flip one bit of the ciphertext, as a careless UPDATE would.
    const ultimul = pachet.length - 1
    pachet[ultimul] = (pachet[ultimul] ?? 0) ^ 0x01
    expect(() => descifreaza(pachet.toString('base64'), CHEIE)).toThrow()
  })

  it('respinge cheia de cifrare greșită', () => {
    const pachet = cifreaza('token', CHEIE)
    expect(() => descifreaza(pachet, randomBytes(32))).toThrow()
  })

  it('respinge un rând trunchiat', () => {
    expect(() => descifreaza('AAAA', CHEIE)).toThrow('trunchiata')
  })

  it('păstrează diacriticele și tokenurile lungi', () => {
    const token = `${'a'.repeat(1200)}-șțăîâ`
    expect(descifreaza(cifreaza(token, CHEIE), CHEIE)).toBe(token)
  })
})
