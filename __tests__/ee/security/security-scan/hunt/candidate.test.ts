/** @jest-environment node */
import {
  admitHuntSubmission,
  formatHuntSubmission,
  huntFingerprint,
  HuntCandidateSchema,
  HUNT_CATEGORIES,
  normalizeHuntCandidate,
} from '@/ee/security/security-scan/hunt/candidate'

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

describe('LUM-1226 hunt submission admission', () => {
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

  it('the contract itself is unchanged: an over-long claim still fails it', () => {
    expect(
      HuntCandidateSchema.safeParse({ ...base, claim: 'c'.repeat(401) }).success
    ).toBe(false)
  })

  it('normalize cuts prose and the call chain, never symbols or files', () => {
    const out = normalizeHuntCandidate({
      ...base,
      precondition: 'p'.repeat(500),
      claim: 'c'.repeat(500),
      call_chain: Array.from({ length: 22 }, () => ({
        from: 'f'.repeat(500),
        to: 't',
      })),
      sink: { symbol: 's'.repeat(500), file: 'f.ts', line: 1 },
    }) as typeof base
    expect(out.precondition).toHaveLength(400)
    expect(out.claim).toHaveLength(400)
    expect(out.call_chain).toHaveLength(20)
    expect(out.call_chain[0]!.from).toHaveLength(400)
    expect(out.sink.symbol).toHaveLength(500)
    expect(normalizeHuntCandidate('x')).toBe('x')
  })

  it('admit keeps the valid, drops the invalid one by one, and names the fields', () => {
    const tally = admitHuntSubmission([
      { ...base, claim: 'c'.repeat(450) },
      { ...base, cwe: 'nope' },
      { ...base, sink: { ...base.sink, line: 0 } },
      'not a candidate',
      base,
    ])
    expect(tally.submitted).toBe(5)
    expect(tally.kept).toHaveLength(2)
    expect(tally.kept[0]!.claim).toHaveLength(400)
    expect(tally.dropped).toBe(3)
    expect(tally.reasons).toEqual(['cwe', 'sink.line', 'candidate'])
  })

  it('admit caps a task at 10 and counts the rest as dropped for limit', () => {
    const tally = admitHuntSubmission(Array.from({ length: 11 }, () => base))
    expect(tally.kept).toHaveLength(10)
    expect(tally.dropped).toBe(1)
    expect(tally.reasons).toEqual(['limit'])
  })

  it('formats the deploy-log line', () => {
    expect(
      formatHuntSubmission({
        calls: 1,
        submitted: 3,
        kept: 2,
        dropped: 1,
        reasons: ['cwe', 'sink'],
      })
    ).toBe('submitted=3 kept=2 dropped=1 calls=1 reasons=cwe,sink')
    expect(
      formatHuntSubmission({ calls: 1, submitted: 0, kept: 0, dropped: 0 })
    ).toBe('submitted=0 kept=0 dropped=0 calls=1')
  })
})
