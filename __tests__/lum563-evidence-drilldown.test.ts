/**
 * LUM-563 — verification conclusions must be drillable into real evidence
 * (diff / run / logs), not just an inert `check:` command. Three layers:
 *   1. parseEvidencePointer (shared) decomposes the evidence grammar.
 *   2. normalizeRepoWebUrl / formatEvidenceDrilldown (CLI) turn a pointer into
 *      a navigable, actionable line.
 *   3. formatTaskStatus renders that drill line under each verdict, and an
 *      honest "evidence pending" line for an evidence-required criterion with
 *      no reference yet (never a dead bare `[evidence]` tag).
 */
import { parseEvidencePointer } from '../shared/src/acceptance-evidence'
import {
  normalizeRepoWebUrl,
  formatEvidenceDrilldown,
} from '../cli/src/lib/evidence-display'
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../cli/src/commands/task-status'

describe('parseEvidencePointer (shared grammar decomposition)', () => {
  it('decomposes a commit pointer', () => {
    expect(parseEvidencePointer('commit:a1b2c3d')).toEqual({
      kind: 'commit',
      hash: 'a1b2c3d',
    })
  })

  it('decomposes a file pointer with a single line', () => {
    expect(parseEvidencePointer('file:lib/services/x.ts:42')).toEqual({
      kind: 'file',
      path: 'lib/services/x.ts',
      line: '42',
    })
  })

  it('decomposes a file pointer with a line range', () => {
    expect(parseEvidencePointer('file:a/b.ts:42-50')).toEqual({
      kind: 'file',
      path: 'a/b.ts',
      line: '42-50',
    })
  })

  it('decomposes a cmd pointer, preserving a # embedded in the command', () => {
    expect(parseEvidencePointer('cmd:npm test -- --grep "a#b"#exit=1')).toEqual(
      {
        kind: 'cmd',
        command: 'npm test -- --grep "a#b"',
        exitCode: 1,
      }
    )
  })

  it('returns null for anything outside the grammar', () => {
    expect(parseEvidencePointer('totally free text')).toBeNull()
    expect(parseEvidencePointer('commit:nothex!')).toBeNull()
    expect(parseEvidencePointer('cmd:no exit marker')).toBeNull()
    expect(parseEvidencePointer('')).toBeNull()
  })
})

describe('normalizeRepoWebUrl', () => {
  it('maps an scp-style git@ remote to an https web base', () => {
    expect(normalizeRepoWebUrl('git@github.com:lumo/lumo.git')).toBe(
      'https://github.com/lumo/lumo'
    )
  })

  it('maps an https remote (with .git) to a web base', () => {
    expect(normalizeRepoWebUrl('https://github.com/lumo/lumo.git')).toBe(
      'https://github.com/lumo/lumo'
    )
  })

  it('maps an ssh:// remote to a web base', () => {
    expect(normalizeRepoWebUrl('ssh://git@github.com/lumo/lumo.git')).toBe(
      'https://github.com/lumo/lumo'
    )
  })

  it('fails closed to null on an unparseable / empty remote', () => {
    expect(normalizeRepoWebUrl('')).toBeNull()
    expect(normalizeRepoWebUrl('not a url')).toBeNull()
  })
})

describe('formatEvidenceDrilldown', () => {
  it('renders a cmd pointer as a re-runnable command + exit', () => {
    const out = formatEvidenceDrilldown('cmd:npx jest x#exit=0', null)
    expect(out).toContain('npx jest x')
    expect(out).toContain('exit 0')
    expect(out).toMatch(/re-run/i)
    // No longer the inert raw token.
    expect(out).not.toContain('cmd:npx jest x#exit=0')
  })

  it('renders a commit pointer as a web URL when the repo resolves', () => {
    const out = formatEvidenceDrilldown(
      'commit:a1b2c3d',
      'https://github.com/lumo/lumo'
    )
    expect(out).toContain('https://github.com/lumo/lumo/commit/a1b2c3d')
  })

  it('renders a commit pointer as a git show fallback when no repo URL', () => {
    const out = formatEvidenceDrilldown('commit:a1b2c3d', null)
    expect(out).toContain('git show a1b2c3d')
    expect(out).not.toContain('http')
  })

  it('renders a file pointer as a clickable path:line', () => {
    const out = formatEvidenceDrilldown('file:a/b.ts:42', null)
    expect(out).toContain('a/b.ts:42')
  })

  it('falls back to the raw pointer for an unrecognised shape', () => {
    const out = formatEvidenceDrilldown('weird:thing', null)
    expect(out).toContain('weird:thing')
  })
})

/** A minimal status payload — overridable per test. */
function baseResponse(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't1',
      identifier: 'LUM-563',
      title: 'demo',
      status: 'IN_REVIEW',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

function machineCriterion(
  over: Partial<TaskStatusResponse['criteria'][number]> = {}
): TaskStatusResponse['criteria'][number] {
  return {
    id: 'c-1',
    statement: 'does the thing',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest x',
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    verdictStale: false,
    checkMismatch: false,
    machinePassed: true,
    confirmedAt: '2026-06-01T00:00:00Z',
    latestVerdict: {
      round: 1,
      verdict: 'PASS',
      evidencePointer: 'cmd:npx jest x#exit=0',
      rejectionReason: null,
      rejectionReasonEnum: null,
      recordedAt: '2026-06-02T10:00:00Z',
    },
    sendBackResolution: null,
    ...over,
  }
}

describe('formatTaskStatus evidence drill-down (LUM-563)', () => {
  it('renders a MACHINE pass evidence pointer as a drillable line, not the raw token', () => {
    const out = formatTaskStatus(
      baseResponse({ criteria: [machineCriterion()] })
    )
    expect(out).toMatch(/↳ evidence:/)
    expect(out).toContain('npx jest x')
    expect(out).toContain('exit 0')
    // The inert raw token must be gone from the verdict line.
    expect(out).not.toContain('· cmd:npx jest x#exit=0')
  })

  it('drills a commit pointer to a web URL when extras carry a repo URL', () => {
    const out = formatTaskStatus(
      baseResponse({
        criteria: [
          machineCriterion({
            latestVerdict: {
              round: 1,
              verdict: 'PASS',
              evidencePointer: 'commit:a1b2c3d',
              rejectionReason: null,
              rejectionReasonEnum: null,
              recordedAt: '2026-06-02T10:00:00Z',
            },
          }),
        ],
      }),
      { repoWebUrl: 'https://github.com/lumo/lumo' }
    )
    expect(out).toContain('https://github.com/lumo/lumo/commit/a1b2c3d')
  })

  it('drills a FAIL cmd pointer so the failing run is re-runnable', () => {
    const out = formatTaskStatus(
      baseResponse({
        criteria: [
          machineCriterion({
            machinePassed: false,
            latestVerdict: {
              round: 1,
              verdict: 'FAIL',
              evidencePointer: 'cmd:npx jest x#exit=1',
              rejectionReason: 'boom',
              rejectionReasonEnum: 'CRITERION_UNMET',
              recordedAt: '2026-06-02T10:00:00Z',
            },
          }),
        ],
      })
    )
    expect(out).toMatch(/✗ FAIL@r1/)
    expect(out).toMatch(/↳ evidence:/)
    expect(out).toContain('exit 1')
  })

  it('renders an honest pending line for a HUMAN evidence-required criterion with no reference yet', () => {
    const out = formatTaskStatus(
      baseResponse({
        criteria: [
          {
            id: 'h-1',
            statement: 'looks right by eye',
            verifierType: 'HUMAN',
            checkpointer: null,
            evidenceRequired: true,
            judgeSteps: null,
            source: 'AGENT_DRAFT',
            addedAtRound: 0,
            verdictStale: false,
            checkMismatch: false,
            machinePassed: false,
            confirmedAt: '2026-06-01T00:00:00Z',
            latestVerdict: null,
            sendBackResolution: null,
          },
        ],
        nextActions: [
          {
            criterionId: 'h-1',
            statement: 'looks right by eye',
            verifierType: 'HUMAN',
            checkpointer: null,
            judgeSteps: null,
            source: 'AGENT_DRAFT',
            addedAtRound: 0,
            rejectionReason: null,
          },
        ],
      })
    )
    expect(out).toMatch(/↳ evidence: pending/i)
    expect(out).toMatch(/no reference recorded/i)
  })

  it('drills a HUMAN pass that carries an evidence pointer (same as machine)', () => {
    const out = formatTaskStatus(
      baseResponse({
        criteria: [
          {
            id: 'h-2',
            statement: 'human signed off',
            verifierType: 'HUMAN',
            checkpointer: null,
            evidenceRequired: true,
            judgeSteps: null,
            source: 'AGENT_DRAFT',
            addedAtRound: 0,
            verdictStale: false,
            checkMismatch: false,
            machinePassed: false,
            confirmedAt: '2026-06-01T00:00:00Z',
            latestVerdict: {
              round: 1,
              verdict: 'PASS',
              evidencePointer: 'file:docs/spec.md:10',
              rejectionReason: null,
              rejectionReasonEnum: null,
              recordedAt: '2026-06-02T10:00:00Z',
            },
            sendBackResolution: null,
          },
        ],
      })
    )
    expect(out).toMatch(/↳ evidence:/)
    expect(out).toContain('docs/spec.md:10')
    expect(out).not.toMatch(/pending/i)
  })
})
