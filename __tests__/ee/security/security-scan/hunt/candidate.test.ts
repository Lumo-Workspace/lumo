/** @jest-environment node */
import {
  huntFingerprint,
  HuntCandidateSchema,
  HUNT_CATEGORIES,
} from '@/lib/security-scan/hunt/candidate'

describe('LUM-739 hunt candidate', () => {
  it('fingerprint is 16 hex chars and stable', () => {
    const a = huntFingerprint('idor', 'a#b@1', 'a#GET')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(huntFingerprint('idor', 'a#b@1', 'a#GET')).toBe(a)
    expect(huntFingerprint('ssrf', 'a#b@1', 'a#GET')).not.toBe(a)
  })

  it('schema rejects a malformed cwe and unknown category', () => {
    const base = {
      category: 'idor',
      cwe: 'CWE-639',
      severity: 'LOW',
      sink: { symbol: 's', file: 'f.ts', line: 1 },
      entry: { symbol: 'e', file: 'f.ts', line: 1 },
      call_chain: [{ from: 'e', to: 's' }],
      precondition: 'p',
      claim: 'c',
    }
    expect(HuntCandidateSchema.safeParse(base).success).toBe(true)
    expect(HuntCandidateSchema.safeParse({ ...base, cwe: 'x' }).success).toBe(
      false
    )
    expect(
      HuntCandidateSchema.safeParse({ ...base, category: 'xss' }).success
    ).toBe(false)
    expect(HUNT_CATEGORIES).toHaveLength(6)
  })
})
