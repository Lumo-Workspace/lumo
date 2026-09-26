/**
 * @jest-environment node
 *
 * LUM-842: the short status block that state-changing commands print so the
 * agent no longer follows each of them with `lumo task status`.
 */
import {
  fetchStatusDigest,
  formatStatusDigest,
  type StatusRead,
} from '../../src/lib/status-digest'
import type { OpenCrossingsResult } from '../../src/lib/open-crossings'
import type { TaskStatusResponse } from '../../src/commands/task-status'

function criterion(
  id: string,
  verdict: 'PASS' | 'FAIL' | null,
  verifierType: 'MACHINE' | 'HUMAN' = 'MACHINE'
): TaskStatusResponse['criteria'][number] {
  return {
    id,
    statement: `statement ${id}`,
    verifierType,
    checkpointer: verifierType === 'MACHINE' ? 'npm test' : null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    verdictStale: false,
    checkMismatch: false,
    machinePassed: verdict === 'PASS',
    latestVerdict: verdict
      ? {
          round: 1,
          verdict,
          evidencePointer: null,
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-09-25T00:00:00.000Z',
        }
      : null,
    confirmedAt: '2026-09-25T00:00:00.000Z',
  }
}

function unmet(id: string): TaskStatusResponse['nextActions'][number] {
  return {
    criterionId: id,
    statement: `statement ${id} `.repeat(12),
    verifierType: 'MACHINE',
    checkpointer: 'npm test',
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    rejectionReason: 'exit 1',
  }
}

function status(over: Partial<TaskStatusResponse> = {}): StatusRead {
  return {
    ok: true,
    value: {
      version: 1,
      task: { id: 't', identifier: 'LUM-9', title: 'T', status: 'IN_PROGRESS' },
      currentRound: 2,
      maxRounds: 3,
      escalated: false,
      criteria: [],
      machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
      nextActions: [],
      securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
      ...over,
    } as TaskStatusResponse,
  }
}

const NO_CROSSINGS: OpenCrossingsResult = {
  status: 'ok',
  crossings: [],
  gateEnabled: true,
}

function crossing(id: string, blocking: boolean) {
  return {
    id,
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM' as const,
    detail: 'd',
    attribution: {
      workspaceMemberId: null,
      sessionId: null,
      agent: null,
      worktreeBranch: null,
      model: null,
    },
    advisory: !blocking,
    blocking,
    rejudge: null,
  }
}

describe('status digest', () => {
  it('status digest renders status round criteria and blockers in a few lines', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({
        criteria: [
          criterion('c1', 'PASS'),
          criterion('c2', 'FAIL'),
          criterion('c3', null),
          criterion('c4', null),
          criterion('c5', null, 'HUMAN'),
        ],
        nextActions: [
          unmet('c2'),
          unmet('c3'),
          unmet('c4'),
          {
            kind: 'SECURITY_FINDING',
            findingId: 'f1',
            statement: 's',
            severity: 'HIGH',
            provenance: 'DETERMINISTIC',
            blocking: true,
            prNumber: 7,
            ruleId: 'r',
            filePath: 'a.ts',
            line: 1,
          },
          {
            kind: 'TEST_CASE_VERDICT',
            signal: 'PROVEN_DEFECT',
            number: 2,
            title: 'x',
            advisory: true,
          },
          { kind: 'TEST_CASE', statement: 's', command: 'c', advisory: true },
        ],
      }),
      crossings: {
        status: 'ok',
        gateEnabled: true,
        crossings: [crossing('cx-1', true), crossing('cx-2', false)],
      },
    })

    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines[0]).toContain('same read as `lumo task status LUM-9`')
    // 5 criteria, 3 unmet (the HUMAN one with no verdict is a tacit pass).
    expect(lines[1]).toBe('  LUM-9 IN_PROGRESS · round 2/3 · criteria 2/5 met')
    expect(lines[2]).toMatch(/^ {2}Unmet: c2 .+ · c3 .+ \(\+1 more\)$/)
    expect(lines[2]!.length).toBeLessThan(200)
    expect(lines[3]).toBe(
      '  Blocks DONE: 1 send-back · 1 boundary crossing (cx-1) — the user rules · 1 blocking security finding · 1 proven test-case defect'
    )
    expect(lines.join('\n')).not.toContain('cx-2') // advisory: not a blocker
  })

  it('status digest renders a clean task as nothing on record', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({
        task: { id: 't', identifier: 'LUM-9', title: 'T', status: 'IN_REVIEW' },
        criteria: [criterion('c1', 'PASS')],
      }),
      crossings: NO_CROSSINGS,
    })
    expect(lines.slice(1)).toEqual([
      '  LUM-9 IN_REVIEW · round 2/3 · criteria 1/1 met',
      '  Blocks DONE: nothing on record',
    ])
  })

  it('status digest names escalation and a missing contract', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({ currentRound: 0, escalated: true }),
      crossings: NO_CROSSINGS,
    })
    expect(lines[1]).toBe(
      '  LUM-9 IN_PROGRESS · no verify round yet · no acceptance contract · ESCALATED — stop running lumo verify'
    )
  })

  it('status digest fails closed when the status read failed', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: { ok: false, reason: 'HTTP 500' },
      crossings: NO_CROSSINGS,
    })
    expect(lines[1]).toContain('Could not read the current status (HTTP 500)')
    expect(lines.join('\n')).not.toContain('nothing on record')
  })

  it('status digest fails closed on a null security-findings read', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({ securityFindings: null }),
      crossings: NO_CROSSINGS,
    })
    expect(lines.join('\n')).toContain('Could not confirm security findings')
    expect(lines.join('\n')).not.toContain('nothing on record')
  })

  it('status digest fails closed when the crossings read failed', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({ criteria: [criterion('c1', 'FAIL')] }),
      crossings: { status: 'error', reason: 'HTTP 502' },
    })
    const out = lines.join('\n')
    expect(out).toContain('Blocks DONE: 1 send-back')
    expect(out).toContain('Could not confirm boundary crossings (HTTP 502)')
    expect(out).not.toContain('nothing on record')
  })

  it('status digest fails closed on a malformed or unreachable status response', async () => {
    const saved = global.fetch
    try {
      global.fetch = jest.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('/status') ? { unexpected: true } : { crossings: [] },
      })) as unknown as typeof fetch
      let lines = await fetchStatusDigest('https://x.test', 'tok', 'LUM-9')
      expect(lines[1]).toContain('unexpected response shape')

      global.fetch = jest.fn(async () => {
        throw new Error('ECONNRESET')
      }) as unknown as typeof fetch
      lines = await fetchStatusDigest('https://x.test', 'tok', 'LUM-9')
      expect(lines[1]).toContain(
        'Could not read the current status (ECONNRESET)'
      )
      expect(lines.join('\n')).not.toContain('nothing on record')
    } finally {
      global.fetch = saved
    }
  })

  it('status digest reads the same GET /status endpoint as lumo task status', async () => {
    const saved = global.fetch
    try {
      const body = (status() as { value: TaskStatusResponse }).value
      const fetchMock = jest.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('/status') ? body : { crossings: [], gateEnabled: true },
      }))
      global.fetch = fetchMock as unknown as typeof fetch
      const lines = await fetchStatusDigest('https://x.test', 'tok', 'LUM-9')
      expect(fetchMock.mock.calls.map(c => c[0]).sort()).toEqual([
        'https://x.test/api/tasks/LUM-9/boundary-crossings',
        'https://x.test/api/tasks/LUM-9/status',
      ])
      expect(lines[2]).toBe('  Blocks DONE: nothing on record')
    } finally {
      global.fetch = saved
    }
  })
})
