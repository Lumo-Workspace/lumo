/** @jest-environment node */
import {
  isWeakeningCandidate,
  classifyWeakening,
} from '@/lib/boundary-crossing/contract-weakening-judge'

describe('isWeakeningCandidate', () => {
  const yes = { hasOpenFail: true, isAgentEdit: true, statementChanged: true }
  it('is true only when open-FAIL + agent edit + statement changed', () => {
    expect(isWeakeningCandidate(yes)).toBe(true)
    expect(isWeakeningCandidate({ ...yes, hasOpenFail: false })).toBe(false)
    expect(isWeakeningCandidate({ ...yes, isAgentEdit: false })).toBe(false)
    expect(isWeakeningCandidate({ ...yes, statementChanged: false })).toBe(
      false
    )
  })
})

describe('classifyWeakening', () => {
  const input = {
    oldStatement: 'returns 200 with the full payload',
    newStatement: 'returns a response',
    causeTag: null,
  }

  it('returns the judge verdict', async () => {
    await expect(
      classifyWeakening(input, { judge: async () => 'WEAKENED' })
    ).resolves.toBe('WEAKENED')
    await expect(
      classifyWeakening(input, { judge: async () => 'EVOLVED' })
    ).resolves.toBe('EVOLVED')
  })

  it('falls back to WEAKENED on judge error (suspicion already established)', async () => {
    await expect(
      classifyWeakening(input, {
        judge: async () => {
          throw new Error('boom')
        },
      })
    ).resolves.toBe('WEAKENED')
  })

  it('falls back to WEAKENED on timeout', async () => {
    await expect(
      classifyWeakening(input, {
        timeoutMs: 5,
        judge: () =>
          new Promise(resolve => setTimeout(() => resolve('EVOLVED'), 50)),
      })
    ).resolves.toBe('WEAKENED')
  })
})
