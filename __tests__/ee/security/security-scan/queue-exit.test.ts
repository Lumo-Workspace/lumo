/**
 * @jest-environment node
 *
 * LUM-775 — the queue's exit door. A PR finding's review window is the PR;
 * once the PR is merged or closed the question changes from "what did this
 * change introduce" to "what is on main now", and the default-branch
 * baseline (LUM-738) is the only witness that may answer it. Derived at
 * read time, never written: `disposition` stays human-only.
 */
import {
  baselineVouch,
  externalToolSlug,
  explainQueueExit,
  queueExitContext,
  queueExitReason,
  type QueueExitFinding,
  type QueueExitPr,
} from '@/ee/security/security-scan/queue-exit'
import { DEFAULT_SECURITY_POLICY } from '@/ee/security/security-scan/policy'
import type { SecurityBaseline } from '@/ee/security/security-scan/types'

const MERGED_AT = new Date('2026-09-10T10:00:00Z')

function baseline(over: Partial<SecurityBaseline> = {}): SecurityBaseline {
  return {
    sha: 'abc',
    at: '2026-09-10T11:00:00Z',
    requestedAt: '2026-09-10T10:30:00Z',
    fingerprints: ['fp-still-there'],
    partial: false,
    tools: ['gitleaks', 'semgrep', 'osv-scanner'],
    ...over,
  }
}

const merged: QueueExitPr = { state: 'merged', mergedAt: MERGED_AT }
const open: QueueExitPr = { state: 'open', mergedAt: null }
const closed: QueueExitPr = { state: 'closed', mergedAt: null }

function finding(over: Partial<QueueExitFinding> = {}): QueueExitFinding {
  return {
    ruleId: 'ext:osv-scanner:GHSA-xxxx',
    provenance: 'EXTERNAL_TOOL',
    severity: 'MEDIUM',
    disposition: null,
    persisting: false,
    fingerprint: 'fp-gone',
    ...over,
  }
}

const policy = DEFAULT_SECURITY_POLICY

describe('externalToolSlug', () => {
  it('reads the tool slug out of an ext: rule id and nothing else', () => {
    expect(externalToolSlug('ext:osv-scanner:GHSA-1')).toBe('osv-scanner')
    expect(externalToolSlug('ext:semgrep:javascript.lang.x')).toBe('semgrep')
    expect(externalToolSlug('secret:aws-access-key-id')).toBeNull()
    expect(externalToolSlug('hunt:idor')).toBeNull()
    expect(externalToolSlug('ext:')).toBeNull()
  })
})

describe('baselineVouch — when the default-branch baseline may testify', () => {
  it('absent from a fresh, whole baseline that ran the tool → absent', () => {
    const ctx = queueExitContext(baseline())
    expect(baselineVouch(ctx, merged, 'osv-scanner')).toEqual({
      kind: 'absent',
    })
  })

  it('present in that baseline → present', () => {
    const ctx = queueExitContext(baseline())
    expect(baselineVouch(ctx, merged, 'osv-scanner', 'fp-still-there')).toEqual(
      { kind: 'present' }
    )
  })

  it.each([
    ['no baseline at all', undefined, 'no baseline'],
    ['repo never scanned', null, 'no baseline'],
    ['run still in flight', baseline({ at: null }), 'baseline in flight'],
    ['partial set', baseline({ partial: true }), 'baseline partial'],
    [
      'requested before the merge',
      baseline({ requestedAt: '2026-09-10T09:00:00Z' }),
      'baseline predates merge',
    ],
    [
      'tool not in the set',
      baseline({ tools: ['gitleaks', 'semgrep'] }),
      'tool not in baseline',
    ],
  ] as const)('%s → cannot', (_label, b, why) => {
    const ctx = queueExitContext(b)
    expect(baselineVouch(ctx, merged, 'osv-scanner')).toEqual({
      kind: 'cannot',
      why,
    })
  })

  it('a merged PR with no mergedAt on record cannot be dated → cannot', () => {
    const ctx = queueExitContext(baseline())
    expect(
      baselineVouch(ctx, { state: 'merged', mergedAt: null }, 'osv-scanner')
    ).toEqual({ kind: 'cannot', why: 'merge undated' })
  })
})

describe('queueExitReason', () => {
  it('an open PR never exits, whatever the finding', () => {
    const ctx = queueExitContext(baseline())
    expect(queueExitReason(finding(), open, ctx, policy)).toBeNull()
    expect(
      queueExitReason(
        finding({ provenance: 'DETERMINISTIC', severity: 'HIGH' }),
        open,
        ctx,
        policy
      )
    ).toBeNull()
  })

  it('a closed, unmerged PR exits everything as PR_CLOSED — nothing landed', () => {
    const ctx = queueExitContext(null)
    expect(queueExitReason(finding(), closed, ctx, policy)).toBe('PR_CLOSED')
    expect(
      queueExitReason(
        finding({
          ruleId: 'secret:aws-access-key-id',
          provenance: 'DETERMINISTIC',
          severity: 'HIGH',
        }),
        closed,
        ctx,
        policy
      )
    ).toBe('PR_CLOSED')
  })

  it('merged + EXTERNAL_TOOL fingerprint absent from a vouching baseline → RESOLVED_ON_MAIN, even for a policy-blocking row', () => {
    const ctx = queueExitContext(baseline())
    expect(queueExitReason(finding(), merged, ctx, policy)).toBe(
      'RESOLVED_ON_MAIN'
    )
    const blockingExternal = {
      block: [
        { provenance: 'EXTERNAL_TOOL' as const, severity: 'HIGH' as const },
      ],
    }
    expect(
      queueExitReason(
        finding({ severity: 'HIGH' }),
        merged,
        ctx,
        blockingExternal
      )
    ).toBe('RESOLVED_ON_MAIN')
  })

  it('merged + EXTERNAL_TOOL fingerprint still in the baseline: advisory → MERGED_UNREVIEWED, policy-blocking → stays', () => {
    const ctx = queueExitContext(baseline())
    const f = finding({ fingerprint: 'fp-still-there' })
    expect(queueExitReason(f, merged, ctx, policy)).toBe('MERGED_UNREVIEWED')
    const blockingExternal = {
      block: [
        { provenance: 'EXTERNAL_TOOL' as const, severity: 'MEDIUM' as const },
      ],
    }
    expect(queueExitReason(f, merged, ctx, blockingExternal)).toBeNull()
  })

  it('merged + baseline cannot vouch: advisory → MERGED_UNREVIEWED, blocking → stays (fail-closed)', () => {
    const stale = queueExitContext(
      baseline({ requestedAt: '2026-09-10T09:00:00Z' })
    )
    expect(queueExitReason(finding(), merged, stale, policy)).toBe(
      'MERGED_UNREVIEWED'
    )
    const deterministicHigh = finding({
      ruleId: 'secret:aws-access-key-id',
      provenance: 'DETERMINISTIC',
      severity: 'HIGH',
    })
    expect(
      queueExitReason(deterministicHigh, merged, queueExitContext(null), policy)
    ).toBeNull()
    // A fresh baseline does not testify for Lumo's own layers either: the
    // deterministic secret scanner and the LLM judge are not in the set.
    expect(
      queueExitReason(
        deterministicHigh,
        merged,
        queueExitContext(baseline()),
        policy
      )
    ).toBeNull()
  })

  it('merged LOW deterministic fixture secrets and LLM_JUDGE rows are advisory → MERGED_UNREVIEWED', () => {
    const ctx = queueExitContext(baseline())
    expect(
      queueExitReason(
        finding({
          ruleId: 'secret:aws-access-key-id',
          provenance: 'DETERMINISTIC',
          severity: 'LOW',
        }),
        merged,
        ctx,
        policy
      )
    ).toBe('MERGED_UNREVIEWED')
    expect(
      queueExitReason(
        finding({
          ruleId: 'vuln:sqli',
          provenance: 'LLM_JUDGE',
          severity: 'HIGH',
        }),
        merged,
        ctx,
        policy
      )
    ).toBe('MERGED_UNREVIEWED')
  })

  it("dispositioned or persisting rows are not this door's business → null", () => {
    const ctx = queueExitContext(baseline())
    expect(
      queueExitReason(
        finding({ disposition: 'FALSE_POSITIVE' }),
        merged,
        ctx,
        policy
      )
    ).toBeNull()
    expect(
      queueExitReason(finding({ persisting: true }), merged, ctx, policy)
    ).toBeNull()
  })

  it('an unknown PR state is treated like open (fail-closed: stay in the queue)', () => {
    const ctx = queueExitContext(baseline())
    expect(
      queueExitReason(
        finding(),
        { state: 'weird', mergedAt: null },
        ctx,
        policy
      )
    ).toBeNull()
  })
})

describe('explainQueueExit — the report\'s "why is this still here"', () => {
  it('names the exit, or why the row stays', () => {
    const ctx = queueExitContext(baseline())
    expect(explainQueueExit(finding(), merged, ctx, policy)).toEqual({
      exit: 'RESOLVED_ON_MAIN',
      why: 'absent from default-branch baseline',
    })
    expect(explainQueueExit(finding(), open, ctx, policy)).toEqual({
      exit: null,
      why: 'PR open',
    })
    expect(
      explainQueueExit(
        finding({
          ruleId: 'secret:aws-access-key-id',
          provenance: 'DETERMINISTIC',
          severity: 'HIGH',
        }),
        merged,
        queueExitContext(null),
        policy
      )
    ).toEqual({
      exit: null,
      why: 'blocking under policy; baseline cannot vouch (not an external-tool finding)',
    })
    expect(
      explainQueueExit(
        finding({ fingerprint: 'fp-still-there' }),
        merged,
        ctx,
        policy
      )
    ).toEqual({
      exit: 'MERGED_UNREVIEWED',
      why: 'advisory; still in default-branch baseline',
    })
  })
})
