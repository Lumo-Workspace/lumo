import {
  buildPerPrGateAudit,
  type GateHookEventRow,
  type GateSignalRow,
  type PrRef,
} from '@/lib/services/gate-audit'

/**
 * LUM-839: the two check sources are no longer merged into one per-key verdict
 * (LUM-616 precedence is gone with the typecheck/build/test taxonomy). Both are
 * shown side by side; neither changes the other.
 */

const PR: PrRef = {
  number: 960,
  title: 'managed ci',
  state: 'merged',
  headBranch: 'lumo/LUM-746-x',
  headSha: 'h960',
}

function selfRun(command: string, at: string): GateHookEventRow {
  return {
    type: 'POST_TOOL_USE',
    payload: { tool_name: 'Bash', tool_input: { command } },
    createdAt: new Date(at),
    sessionId: null,
  }
}

describe('gate-audit — CI and self-report are not merged (LUM-839)', () => {
  it('a historical Lumo-managed CI failure shows by name next to a later agent pass', () => {
    const sandboxRow: GateSignalRow = {
      outcome: 'failure',
      checkName: 'lumo/ci test',
      detailsUrl: null,
      source: 'lumo_sandbox',
      createdAt: new Date('2026-09-10T10:00:00.000Z'),
      headSha: 'h960',
      prNumber: 960,
    }
    const { prs } = buildPerPrGateAudit({
      hookRows: [selfRun('npx jest', '2026-09-10T11:00:00.000Z')],
      gateSignals: [sandboxRow],
      pullRequests: [PR],
      sessionBranchById: {},
    })
    const audit = prs[0]!.audit
    expect(audit.ci).toEqual([
      {
        name: 'lumo/ci test',
        status: 'failed',
        source: 'lumo_sandbox',
        detailsUrl: null,
        at: '2026-09-10T10:00:00.000Z',
      },
    ])
    expect(audit.selfReported).toEqual([
      {
        command: 'npx jest',
        status: 'passed',
        exitCode: 0,
        at: '2026-09-10T11:00:00.000Z',
      },
    ])
  })
})
