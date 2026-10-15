/**
 * @jest-environment node
 *
 * LUM-1147 — the review profile decides which findings get an inline
 * comment (quiet < chill < assertive); HIGH and Done-blocking findings are
 * inline under every profile.
 */
import {
  DEFAULT_REVIEW_PROFILE,
  heldByProfile,
  inlineEligibleUnder,
  parseReviewProfile,
  REVIEW_PROFILES,
  type ProfileFinding,
} from '@/ee/security/security-scan/review-profile'
import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'

const f = (over: Partial<ProfileFinding> = {}): ProfileFinding => ({
  line: 3,
  severity: 'MEDIUM',
  provenance: 'LLM_JUDGE',
  disposition: null,
  suggestedDisposition: null,
  ...over,
})

/** A policy that blocks DONE on LOW deterministic findings. */
const LOW_BLOCKS: SecurityPolicy = {
  ...DEFAULT_SECURITY_POLICY,
  block: [{ provenance: 'DETERMINISTIC', severity: 'LOW' }],
}

describe('LUM-1147 review profile — parse', () => {
  it('reads the three profiles; anything else is chill', () => {
    for (const p of REVIEW_PROFILES) expect(parseReviewProfile(p)).toBe(p)
    expect(DEFAULT_REVIEW_PROFILE).toBe('chill')
    for (const raw of [null, undefined, '', 'QUIET', 'loud', 3])
      expect(parseReviewProfile(raw)).toBe('chill')
  })
})

describe('LUM-1147 review profile — inline eligibility', () => {
  const P = DEFAULT_SECURITY_POLICY
  const table: Array<[string, ProfileFinding['severity'], boolean[]]> = [
    // severity → [quiet, chill, assertive]
    ['HIGH', 'HIGH', [true, true, true]],
    ['MEDIUM', 'MEDIUM', [false, true, true]],
    ['LOW', 'LOW', [false, false, true]],
  ]
  it.each(table)(
    '%s findings: quiet / chill / assertive',
    (_, severity, expected) => {
      expect(
        (['quiet', 'chill', 'assertive'] as const).map(p =>
          inlineEligibleUnder(p, f({ severity }), P)
        )
      ).toEqual(expected)
    }
  )

  it('chill is exactly the pre-1147 rule (line, not LOW, not suggested)', () => {
    expect(inlineEligibleUnder('chill', f({ severity: 'LOW' }), P)).toBe(false)
    expect(inlineEligibleUnder('chill', f({ line: null }), P)).toBe(false)
    expect(
      inlineEligibleUnder(
        'chill',
        f({ suggestedDisposition: 'FALSE_POSITIVE' }),
        P
      )
    ).toBe(false)
    expect(inlineEligibleUnder('chill', f(), P)).toBe(true)
  })

  it('HIGH security findings stay inline under quiet', () => {
    for (const provenance of [
      'DETERMINISTIC',
      'EXTERNAL_TOOL',
      'LLM_JUDGE',
    ] as const)
      expect(
        inlineEligibleUnder('quiet', f({ severity: 'HIGH', provenance }), P)
      ).toBe(true)
  })

  it('a Done-blocking finding is inline under every profile, whatever its severity', () => {
    const blocking = f({ severity: 'LOW', provenance: 'DETERMINISTIC' })
    for (const p of REVIEW_PROFILES)
      expect(inlineEligibleUnder(p, blocking, LOW_BLOCKS)).toBe(true)
    // …and a MEDIUM blocking one under quiet.
    const mediumBlocks: SecurityPolicy = {
      ...DEFAULT_SECURITY_POLICY,
      block: [{ provenance: 'DETERMINISTIC', severity: 'MEDIUM' }],
    }
    expect(
      inlineEligibleUnder(
        'quiet',
        f({ severity: 'MEDIUM', provenance: 'DETERMINISTIC' }),
        mediumBlocks
      )
    ).toBe(true)
  })

  it('a dispositioned or persisting row is not blocking, so the profile applies', () => {
    for (const over of [
      { disposition: 'ACCEPTED_RISK' as const },
      { persisting: true },
    ])
      expect(
        inlineEligibleUnder(
          'quiet',
          f({ severity: 'LOW', provenance: 'DETERMINISTIC', ...over }),
          LOW_BLOCKS
        )
      ).toBe(false)
  })

  it('no profile comments a finding without a line or a suggested false positive', () => {
    for (const p of REVIEW_PROFILES) {
      expect(
        inlineEligibleUnder(p, f({ severity: 'HIGH', line: null }), P)
      ).toBe(false)
      expect(
        inlineEligibleUnder(
          p,
          f({ severity: 'HIGH', suggestedDisposition: 'FALSE_POSITIVE' }),
          P
        )
      ).toBe(false)
    }
  })
})

describe('LUM-1147 review profile — held for the summary', () => {
  const P = DEFAULT_SECURITY_POLICY
  it('quiet holds MEDIUM findings chill would comment; nothing else is held', () => {
    expect(heldByProfile('quiet', f({ severity: 'MEDIUM' }), P)).toBe(true)
    expect(heldByProfile('quiet', f({ severity: 'HIGH' }), P)).toBe(false)
    expect(heldByProfile('quiet', f({ severity: 'LOW' }), P)).toBe(false)
    expect(heldByProfile('quiet', f({ line: null }), P)).toBe(false)
    for (const p of ['chill', 'assertive'] as const)
      for (const severity of ['LOW', 'MEDIUM', 'HIGH'] as const)
        expect(heldByProfile(p, f({ severity }), P)).toBe(false)
  })
})
