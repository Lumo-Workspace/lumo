/** @jest-environment node */
// LUM-739: the per-PR scan line renders the L3 hunt layer after judge.
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'

function payload(
  scans: NonNullable<TaskStatusResponse['securityFindings']>['scans']
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't-1',
      identifier: 'LUM-9',
      title: 'do the thing',
      status: 'IN_PROGRESS',
    },
    currentRound: 0,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    lastRoundFailures: [],
    nextActions: [],
    securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [], scans },
  } as unknown as TaskStatusResponse
}

describe('LUM-739 hunt stage', () => {
  it('renders `hunt <STATE>` after judge, with the partial flag', () => {
    const out = formatTaskStatus(
      payload([
        {
          prNumber: 12,
          status: 'FINDINGS',
          stages: {
            secrets: 'RAN',
            external: 'RAN',
            judge: 'RAN',
            hunt: 'PARTIAL',
          },
          partial: true,
          error: null,
          externalFindings: 0,
          openFindings: 1,
        },
      ])
    )
    expect(out).toContain(
      "PR #12 · scan FINDINGS · Secrets: checked · Code scan: checked · AI review: checked · Exploit paths: \u26a0 partly checked · part of this scan hasn't finished on our side — not counted as checked"
    )
  })

  it('renders no hunt segment when the scan has no hunt key (older rows)', () => {
    const out = formatTaskStatus(
      payload([
        {
          prNumber: 3,
          status: 'CLEAN',
          stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
          partial: false,
          error: null,
          externalFindings: 0,
          openFindings: 0,
        },
      ])
    )
    expect(out).toContain(
      'PR #3 · scan CLEAN · Secrets: checked · Code scan: checked · AI review: checked'
    )
    expect(out).not.toContain('hunt')
  })

  it('LUM-758 leads each coverage row with its task id so two tasks of the same category stay apart', () => {
    const out = formatTaskStatus(
      payload([
        {
          prNumber: 12,
          status: 'CLEAN',
          stages: { secrets: 'RAN', judge: 'RAN', hunt: 'RAN' },
          partial: false,
          error: null,
          externalFindings: 0,
          openFindings: 0,
          hunt: {
            total: 2,
            done: 2,
            categories: [
              {
                taskId: 't1',
                objective: 'raw SQL built from req.query in lib/db.ts',
                category: 'injection',
                stopped: 'done',
                elapsedMs: 41_200,
                tokens: 1200,
                candidates: 1,
                attempts: 1,
              },
              {
                taskId: 't2',
                objective: 'child_process.exec on a request-derived path',
                category: 'injection',
                stopped: 'done',
                elapsedMs: 12_000,
                tokens: 900,
                candidates: 0,
                attempts: 1,
              },
            ],
          },
        },
      ])
    )
    expect(out).toContain(
      'Exploit paths 2/2 done · t1 injection 41.2s done · t2 injection 12.0s done'
    )
  })

  it('LUM-762 renders the per-category hunt coverage under the scan line', () => {
    const out = formatTaskStatus(
      payload([
        {
          prNumber: 12,
          status: 'CLEAN',
          stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PARTIAL' },
          partial: true,
          error: null,
          externalFindings: 0,
          openFindings: 0,
          hunt: {
            total: 6,
            done: 2,
            categories: [
              {
                category: 'idor',
                stopped: 'done',
                elapsedMs: 41_200,
                tokens: 1200,
                candidates: 1,
                attempts: 1,
              },
              {
                category: 'injection',
                stopped: 'done',
                elapsedMs: 72_000,
                tokens: 900,
                candidates: 0,
                attempts: 2,
              },
              {
                category: 'ssrf',
                stopped: 'timeout',
                elapsedMs: 120_000,
                tokens: 0,
                candidates: 0,
                attempts: 2,
              },
              {
                category: 'race',
                stopped: 'skipped',
                elapsedMs: 0,
                tokens: 0,
                candidates: 0,
                attempts: 1,
              },
            ],
          },
        },
      ])
    )
    expect(out).toContain(
      'Exploit paths 2/6 done · idor 41.2s done · injection 72.0s done (2 attempts) · ssrf 120.0s timeout (2 attempts) · race skipped'
    )
  })

  it('LUM-762 renders no coverage line when the server sent no hunt audit', () => {
    const out = formatTaskStatus(
      payload([
        {
          prNumber: 3,
          status: 'CLEAN',
          stages: { secrets: 'RAN', hunt: 'RAN' },
          partial: false,
          error: null,
          externalFindings: 0,
          openFindings: 0,
        },
      ])
    )
    expect(out).toContain(
      'PR #3 · scan CLEAN · Secrets: checked · Exploit paths: checked'
    )
    expect(out).not.toContain('done ·')
  })
})
