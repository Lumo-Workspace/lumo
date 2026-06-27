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

// Known deliveries keyed by their merge commit sha — the webhook forward feed
// maps a `This reverts commit <sha>` trailer back to a delivery through here.
const knownDeliveries = new Map<
  string,
  { taskId: string; workspaceId: string }
>()

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findMergedDeliveryByMergeCommitSha: jest.fn(
      async (_workspaceId: string, sha: string) =>
        knownDeliveries.get(sha) ?? null
    ),
  },
}))

beforeEach(() => {
  mockStore.length = 0
  knownDeliveries.clear()
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

// LUM-607 — the webhook forward feed: a `push` to the default branch carrying a
// revert of a known delivery records a REVERTED signal with NO git checkout,
// reading the trailer + sha-membership straight from the push payload. Same well
// rows as the backfill script (source=GIT, keyed by revertingSha), so the two
// paths never double-count.
const DEFAULT_REF = 'refs/heads/main'

describe('gitOutcomeRecorder.recordRevertsFromPush — webhook forward feed', () => {
  it('records a REVERTED signal for a default branch revert of a known delivery idempotently', async () => {
    knownDeliveries.set(DELIVERY, { taskId: 'task-587', workspaceId: 'ws1' })
    const input = {
      workspaceId: 'ws1',
      ref: DEFAULT_REF,
      defaultBranch: 'main',
      commits: [
        {
          sha: REVERT,
          message: `Revert "thing"\n\nThis reverts commit ${DELIVERY}.\n`,
        },
      ],
    }

    const first = await gitOutcomeRecorder.recordRevertsFromPush(input)
    expect(first.inserted).toBe(1)

    const rows = await outcomeSignalRepository.listForTask('task-587')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'GIT',
      kind: 'REVERTED',
      occurredAt: null,
      taskId: 'task-587',
      evidence: {
        mechanism: 'revert-commit',
        revertingSha: REVERT,
        revertedSha: DELIVERY,
      },
    })

    // The same push redelivered must not double-insert.
    const second = await gitOutcomeRecorder.recordRevertsFromPush(input)
    expect(second.inserted).toBe(0)
    expect(await outcomeSignalRepository.listForTask('task-587')).toHaveLength(
      1
    )

    // Cross-source idempotency: a signal already recorded under the same
    // revertingSha (e.g. by the backfill script) blocks re-insert via the push
    // feed — the well stays one row, never a duplicate.
    mockStore.length = 0
    await outcomeSignalRepository.insert({
      workspaceId: 'ws1',
      taskId: 'task-587',
      kind: 'REVERTED',
      source: 'GIT',
      occurredAt: null,
      evidence: {
        mechanism: 'revert-commit',
        revertingSha: REVERT,
        revertedSha: DELIVERY,
      },
    })
    const third = await gitOutcomeRecorder.recordRevertsFromPush(input)
    expect(third.inserted).toBe(0)
    expect(await outcomeSignalRepository.listForTask('task-587')).toHaveLength(
      1
    )
  })

  it('ignores reverts that do not backreference a known DONE delivery on the default branch', async () => {
    knownDeliveries.set(DELIVERY, { taskId: 'task-587', workspaceId: 'ws1' })

    // (a) subject literally says "Revert" but carries no trailer (wording, not
    //     topology) → no signal.
    await gitOutcomeRecorder.recordRevertsFromPush({
      workspaceId: 'ws1',
      ref: DEFAULT_REF,
      defaultBranch: 'main',
      commits: [{ sha: REVERT, message: 'Revert "chore: something" (#999)' }],
    })

    // (b) trailer points at a sha that is NOT a known merged DONE delivery.
    await gitOutcomeRecorder.recordRevertsFromPush({
      workspaceId: 'ws1',
      ref: DEFAULT_REF,
      defaultBranch: 'main',
      commits: [
        {
          sha: REVERT,
          message: `Revert\n\nThis reverts commit ${'0'.repeat(40)}.\n`,
        },
      ],
    })

    // (c) a real revert of a known delivery, but it did NOT land on the default
    //     branch (so it is not on the mainline the well tracks).
    await gitOutcomeRecorder.recordRevertsFromPush({
      workspaceId: 'ws1',
      ref: 'refs/heads/lumo/LUM-1-feature',
      defaultBranch: 'main',
      commits: [
        {
          sha: REVERT,
          message: `Revert\n\nThis reverts commit ${DELIVERY}.\n`,
        },
      ],
    })

    expect(mockStore).toHaveLength(0)
  })
})
