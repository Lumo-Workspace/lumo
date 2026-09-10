/** @jest-environment node */
// LUM-737: `lumo task status` renders undispositioned security findings as
// SECURITY_FINDING next actions, counts only criteria as unmet, and fails
// closed on a failed scan read / an unscanned open PR.
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'

const CRITERION_ACTION = {
  kind: 'CRITERION' as const,
  criterionId: 'c-1',
  statement: 'route rejects bad input',
  verifierType: 'MACHINE' as const,
  checkpointer: 'npx jest x.test.ts',
  judgeSteps: null,
  source: 'AGENT_DRAFT' as const,
  addedAtRound: 0,
  rejectionReason: null,
}
const SECURITY_ACTION = {
  kind: 'SECURITY_FINDING' as const,
  findingId: 'f1',
  statement: 'secret:aws-access-key-id at lib/cfg.ts:12 — AWS access key id',
  severity: 'HIGH' as const,
  provenance: 'DETERMINISTIC' as const,
  blocking: true,
  prNumber: 12,
  ruleId: 'secret:aws-access-key-id',
  filePath: 'lib/cfg.ts',
  line: 12,
}

function payload(over: Partial<TaskStatusResponse> = {}): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't-1',
      identifier: 'LUM-9',
      title: 'do the thing',
      status: 'IN_PROGRESS',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [
      {
        id: 'c-1',
        statement: 'route rejects bad input',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x.test.ts',
        evidenceRequired: false,
        judgeSteps: null,
        source: 'AGENT_DRAFT',
        addedAtRound: 0,
        verdictStale: false,
        checkMismatch: false,
        machinePassed: false,
        latestVerdict: null,
      },
    ],
    machineVerification: { total: 1, machineVerified: 0, humanOverridden: 0 },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [CRITERION_ACTION],
    securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
    ...over,
  }
}

describe('lumo task status — security findings (LUM-737)', () => {
  it('renders SECURITY_FINDING actions after the criteria, counting only criteria as unmet', () => {
    const out = formatTaskStatus(
      payload({
        nextActions: [
          CRITERION_ACTION,
          SECURITY_ACTION,
          {
            ...SECURITY_ACTION,
            findingId: 'f2',
            provenance: 'LLM_JUDGE' as const,
            blocking: false,
            line: null,
            statement: 'vuln:sqli at lib/q.ts — raw query',
            ruleId: 'vuln:sqli',
            filePath: 'lib/q.ts',
          },
        ],
        securityFindings: { open: 2, blocking: 1, unconfirmedPrs: [] },
      })
    )
    expect(out).toContain('Criteria (1 total, 1 unmet):')
    expect(out).toContain('Next actions (1 unmet · 2 security findings):')
    expect(out).toContain('  • [MACHINE] route rejects bad input')
    expect(out).toContain(
      '  • [SECURITY] [HIGH] DETERMINISTIC secret:aws-access-key-id — lib/cfg.ts:12 — AWS access key id (PR #12 · blocks DONE)'
    )
    expect(out).toContain(
      '  • [SECURITY] [HIGH] LLM_JUDGE vuln:sqli — lib/q.ts — raw query (PR #12 · advisory)'
    )
    expect(out.indexOf('[MACHINE]')).toBeLessThan(out.indexOf('[SECURITY]'))
    // Mixed: the criteria hint AND the findings hint.
    expect(out).toContain(
      'Fix the unmet criteria, then run `lumo verify` (2 rounds left).'
    )
    expect(out).toContain('Fix the findings and push')
    expect(out).toContain('human-only')
  })

  it('security-only plan: no criteria hint, findings hint only', () => {
    const out = formatTaskStatus(
      payload({
        nextActions: [SECURITY_ACTION],
        securityFindings: { open: 1, blocking: 1, unconfirmedPrs: [] },
      })
    )
    expect(out).toContain('Next actions (0 unmet · 1 security finding):')
    expect(out).not.toContain('Fix the unmet criteria')
    expect(out).toContain('Fix the findings and push')
  })

  it('treats a missing kind as CRITERION (older server)', () => {
    const { kind: _k, ...legacy } = CRITERION_ACTION
    const out = formatTaskStatus(
      payload({
        nextActions: [
          legacy as unknown as TaskStatusResponse['nextActions'][number],
        ],
      })
    )
    expect(out).toContain('Next actions (1 unmet):')
    expect(out).toContain('  • [MACHINE] route rejects bad input')
  })

  it('fails closed: null securityFindings prints could-not-confirm, unconfirmed PRs are listed', () => {
    const nul = formatTaskStatus(payload({ securityFindings: null }))
    expect(nul).toContain(
      '⚠ Security-scan check failed — could not confirm whether any findings are undispositioned.'
    )
    const unconfirmed = formatTaskStatus(
      payload({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [
            { number: 14, reason: 'FAILED' },
            { number: 15, reason: 'NONE' },
          ],
        },
      })
    )
    expect(unconfirmed).toContain(
      '⚠ PR #14: security scan FAILED — could not confirm it is clean.'
    )
    expect(unconfirmed).toContain(
      '⚠ PR #15: no security scan has run — could not confirm it is clean.'
    )
  })

  it('an older server without securityFindings prints no security lines at all', () => {
    const { securityFindings: _s, ...older } = payload()
    const out = formatTaskStatus(older as TaskStatusResponse)
    expect(out).not.toContain('Security-scan check failed')
    expect(out).not.toContain('could not confirm')
  })

  it('--full rollup counts only criteria as met/unmet, not security findings (LUM-737 review)', () => {
    // 1 criterion, met (PASS verdict) → nextActions carries none of it, only
    // 2 security findings. The rollup must not subtract those from `met`.
    const out = formatTaskStatus(
      payload({
        criteria: [
          {
            id: 'c-1',
            statement: 'route rejects bad input',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest x.test.ts',
            evidenceRequired: false,
            judgeSteps: null,
            source: 'AGENT_DRAFT',
            addedAtRound: 0,
            verdictStale: false,
            checkMismatch: false,
            machinePassed: true,
            latestVerdict: {
              round: 1,
              verdict: 'PASS',
              evidencePointer: 'cmd:npx jest x.test.ts#exit=0',
              rejectionReason: null,
              rejectionReasonEnum: null,
              recordedAt: '2026-09-03T10:00:00.000Z',
            },
          },
        ],
        nextActions: [SECURITY_ACTION, { ...SECURITY_ACTION, findingId: 'f2' }],
        securityFindings: { open: 2, blocking: 2, unconfirmedPrs: [] },
      }),
      { full: true }
    )
    expect(out).toContain('1 of 1 criteria met by their latest verdict')
    expect(out).not.toContain('-1 of 1 criteria met')
  })
})

describe('lumo task status — zero-criteria security rendering (LUM-737 review)', () => {
  function zeroCriteriaPayload(
    over: Partial<TaskStatusResponse> = {}
  ): TaskStatusResponse {
    return payload({
      criteria: [],
      nextActions: [],
      securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
      ...over,
    })
  }

  it('renders SECURITY_FINDING next actions even with zero criteria', () => {
    const out = formatTaskStatus(
      zeroCriteriaPayload({ nextActions: [SECURITY_ACTION] })
    )
    expect(out).toContain('No acceptance criteria on LUM-9')
    expect(out).toContain(
      '  • [SECURITY] [HIGH] DETERMINISTIC secret:aws-access-key-id — lib/cfg.ts:12 — AWS access key id (PR #12 · blocks DONE)'
    )
    expect(out).toContain('Fix the findings and push')
    expect(out).toContain('human-only')
  })

  it('renders the fail-closed security-scan-failed line even with zero criteria', () => {
    const out = formatTaskStatus(
      zeroCriteriaPayload({ securityFindings: null })
    )
    expect(out).toContain(
      '⚠ Security-scan check failed — could not confirm whether any findings are undispositioned.'
    )
  })
})

describe('LUM-738 supplyChain surface — task status per-PR line', () => {
  const scanRow = (over: object) => ({
    prNumber: 12,
    status: 'FINDINGS' as const,
    stages: {
      secrets: 'RAN',
      external: 'RAN',
      supplyChain: 'RAN',
      judge: 'RAN',
    },
    partial: false,
    error: null,
    externalFindings: 0,
    openFindings: 1,
    ...over,
  })

  it('prints the supplyChain segment in order with the dependency count and its already-on-main share', () => {
    const out = formatTaskStatus(
      payload({
        securityFindings: {
          open: 1,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [scanRow({ dependencyFindings: 3, persistingFindings: 2 })],
        },
      })
    )
    expect(out).toContain(
      '  PR #12 · scan FINDINGS · secrets RAN · external RAN · supplyChain RAN (3 dependency findings, 2 already on main) · judge RAN'
    )
  })

  it('singular, zero, skipped, and an older server without the counts', () => {
    expect(
      formatTaskStatus(
        payload({
          securityFindings: {
            open: 0,
            blocking: 0,
            unconfirmedPrs: [],
            scans: [scanRow({ dependencyFindings: 1, persistingFindings: 0 })],
          },
        })
      )
    ).toContain('supplyChain RAN (1 dependency finding) · judge RAN')
    expect(
      formatTaskStatus(
        payload({
          securityFindings: {
            open: 0,
            blocking: 0,
            unconfirmedPrs: [],
            scans: [
              scanRow({
                stages: { secrets: 'RAN', supplyChain: 'SKIPPED' },
                dependencyFindings: 0,
              }),
            ],
          },
        })
      )
    ).toContain('secrets RAN · supplyChain SKIPPED')
    // Older server: no counts → the segment is still printed, bare.
    expect(
      formatTaskStatus(
        payload({
          securityFindings: {
            open: 0,
            blocking: 0,
            unconfirmedPrs: [],
            scans: [scanRow({})],
          },
        })
      )
    ).toContain('external RAN · supplyChain RAN · judge RAN')
  })
})
