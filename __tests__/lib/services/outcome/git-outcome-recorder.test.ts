/**
 * @jest-environment node
 *
 * LUM-601 — the git-topology detector wired into the LUM-598 outcome well.
 * Real service + real repository over a tiny stateful Prisma fake, so the
 * "detect → record → re-run is idempotent" round-trip is exercised end to end.
 */
import { gitOutcomeRecorder } from '@/lib/services/outcome/git-outcome-recorder'
import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'
import type { GitRunner } from '@/lib/services/outcome/git-referent-detector'

const mockStore: Array<Record<string, unknown>> = []

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    outcomeSignal: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `sig_${mockStore.length + 1}`,
          detectedAt: new Date(),
          ...data,
        }
        mockStore.push(row)
        return row
      }),
      count: jest.fn(
        async ({ where }: { where: { taskId: string } }) =>
          mockStore.filter(r => r.taskId === where.taskId).length
      ),
      findMany: jest.fn(async ({ where }: { where?: { taskId?: string } }) =>
        mockStore.filter(r => !where?.taskId || r.taskId === where.taskId)
      ),
    },
  },
}))

beforeEach(() => {
  mockStore.length = 0
})

const DELIVERY = '7930b19b84ca2e1e409f056a51255627103d12e2'
const REVERT = 'aee920c669b44aa3875327574304067e353bf219'
const RS = '\x1e'
const FS = '\x1f'

// A runner that surfaces exactly one formal revert of the delivery.
const revertRunner: GitRunner = (_file, args) => {
  if (args.join(' ').includes('This reverts commit')) {
    return `${REVERT}${FS}Revert x\n\nThis reverts commit ${DELIVERY}.\n${RS}`
  }
  return ''
}

describe('gitOutcomeRecorder — detector → outcome well', () => {
  it('records a detected git rejection as a source=GIT signal idempotently', async () => {
    const input = {
      workspaceId: 'ws1',
      taskId: 'task-587',
      delivery: { identifier: 'LUM-587', shas: [DELIVERY] },
      run: revertRunner,
    }

    const first = await gitOutcomeRecorder.recordGitRejections(input)
    expect(first.inserted).toBe(1)
    expect(first.skipped).toBe(0)

    const rows = await outcomeSignalRepository.listForTask('task-587')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'GIT',
      kind: 'REVERTED',
      occurredAt: null,
      evidence: {
        mechanism: 'revert-commit',
        revertingSha: REVERT,
        revertedSha: DELIVERY,
      },
    })

    // Re-running over the same history must not double-insert.
    const second = await gitOutcomeRecorder.recordGitRejections(input)
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBe(1)
    expect(await outcomeSignalRepository.listForTask('task-587')).toHaveLength(
      1
    )
  })

  it('records nothing for a clean delivery (no rejection → well stays empty)', async () => {
    const cleanRunner: GitRunner = () => ''
    const res = await gitOutcomeRecorder.recordGitRejections({
      workspaceId: 'ws1',
      taskId: 'task-clean',
      delivery: { identifier: 'LUM-184', shas: ['06544292'] },
      run: cleanRunner,
    })
    expect(res.inserted).toBe(0)
    expect(res.signals).toEqual([])
    expect(
      await outcomeSignalRepository.listForTask('task-clean')
    ).toHaveLength(0)
  })
})
