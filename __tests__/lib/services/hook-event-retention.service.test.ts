/** @jest-environment node */
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@/lib/repositories/hook-event-retention.repository', () => ({
  hookEventRetentionRepository: {
    listWorkspacesWithRetention: jest.fn(),
    findOpenTaskIds: jest.fn(),
    findExpiredEventIds: jest.fn(),
    findCrossingReferencedEventIds: jest.fn(),
    prunePayloads: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { update: jest.fn(), isSlugUnique: jest.fn() },
}))
jest.mock('@/lib/services/workspace-deletion.service', () => ({
  workspaceDeletionService: { deleteWorkspace: jest.fn() },
}))
// LUM-913: the same daily cron also purges PR comment dead letters.
jest.mock('@/lib/services/crossing-raw-retention.service', () => ({
  crossingRawRetentionService: {
    purgeExpired: jest.fn().mockResolvedValue({ purged: 0, capped: false }),
  },
}))
jest.mock('@/lib/services/pr-comment-dead-letter-retention.service', () => ({
  prCommentDeadLetterRetentionService: {
    purgeExpiredPayloads: jest.fn(async () => ({ purged: 0, capped: false })),
  },
}))

import { NextRequest } from 'next/server'
import { hookEventRetentionRepository as repo } from '@/lib/repositories/hook-event-retention.repository'
import { hookEventRetentionService } from '@/lib/services/hook-event-retention.service'
import { workspaceService } from '@/lib/services/workspace.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'
import { GET as cronGET } from '@/app/api/cron/prune-hook-event-payloads/route'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-27T03:45:00Z')

/** In-memory event store standing in for the DB behind the repository. */
interface FakeEvent {
  id: string
  workspaceId: string
  createdAt: Date
  taskId: string | null
  sessionTaskId: string | null
  payload: unknown
  toolName: string | null
  filePath: string | null
  prunedAt: Date | null
}

let events: FakeEvent[]
let crossings: string[]
let tasks: Record<string, 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'>
let retention: { id: string; hookEventRetentionDays: number }[]

function ev(
  id: string,
  ageDays: number,
  over: Partial<FakeEvent> = {}
): FakeEvent {
  return {
    id,
    workspaceId: 'ws_a',
    createdAt: new Date(NOW.getTime() - ageDays * DAY),
    taskId: 't_done',
    sessionTaskId: null,
    payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
    toolName: 'Bash',
    filePath: 'lib/a.ts',
    prunedAt: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  crossings = []
  tasks = { t_done: 'DONE', t_open: 'IN_PROGRESS', t_review: 'IN_REVIEW' }
  retention = [{ id: 'ws_a', hookEventRetentionDays: 90 }]
  ;(repo.listWorkspacesWithRetention as jest.Mock).mockImplementation(
    async () => retention
  )
  ;(repo.findOpenTaskIds as jest.Mock).mockImplementation(async () =>
    Object.entries(tasks)
      .filter(([, s]) => s !== 'DONE')
      .map(([id]) => id)
  )
  // Mirrors the repository's documented query: own taskId, else the
  // session's; taskless events are eligible.
  ;(repo.findExpiredEventIds as jest.Mock).mockImplementation(
    async ({ workspaceId, before, openTaskIds, afterId, take }) =>
      events
        .filter(
          e =>
            e.workspaceId === workspaceId &&
            e.prunedAt === null &&
            e.createdAt < before &&
            (afterId === null || e.id > afterId) &&
            !openTaskIds.includes(e.taskId ?? e.sessionTaskId ?? '')
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, take)
        .map(e => e.id)
  )
  ;(repo.findCrossingReferencedEventIds as jest.Mock).mockImplementation(
    async (ids: string[]) => ids.filter(id => crossings.includes(id))
  )
  ;(repo.prunePayloads as jest.Mock).mockImplementation(
    async (ids: string[], payload: unknown, at: Date) => {
      let n = 0
      for (const e of events) {
        if (ids.includes(e.id) && e.prunedAt === null) {
          e.payload = payload
          e.prunedAt = at
          n++
        }
      }
      return n
    }
  )
})

describe('hookEventRetentionService.pruneExpiredPayloads (LUM-859)', () => {
  it('prunes only expired events outside the exemptions', async () => {
    events = [
      ev('e01_old_done', 120),
      ev('e02_recent', 30),
      ev('e03_old_open_task', 120, { taskId: 't_open' }),
      ev('e04_old_review_task', 120, { taskId: 't_review' }),
      ev('e05_old_crossing', 120),
      ev('e06_old_session_open', 120, {
        taskId: null,
        sessionTaskId: 't_open',
      }),
      ev('e07_old_taskless', 120, { taskId: null }),
      ev('e08_other_ws_old', 400, { workspaceId: 'ws_off' }),
      ev('e09_exactly_90d', 90),
    ]
    crossings = ['e05_old_crossing']

    const result = await hookEventRetentionService.pruneExpiredPayloads(NOW)

    const pruned = events.filter(e => e.prunedAt).map(e => e.id)
    expect(pruned).toEqual(['e01_old_done', 'e07_old_taskless'])
    expect(result.pruned).toBe(2)
    expect(result.workspaces).toEqual([
      { workspaceId: 'ws_a', pruned: 2, keptForCrossings: 1, capped: false },
    ])

    // Only the payload changes — the pruned marker carries time + reason;
    // the row and its derived columns stay.
    const e01 = events.find(e => e.id === 'e01_old_done')!
    expect(e01.payload).toEqual({
      _lumo_pruned: {
        at: NOW.toISOString(),
        reason: 'RETENTION_POLICY',
        retentionDays: 90,
      },
    })
    expect(e01.toolName).toBe('Bash')
    expect(e01.filePath).toBe('lib/a.ts')

    // A workspace with retention off is never queried at all.
    expect(repo.findOpenTaskIds).toHaveBeenCalledTimes(1)
    expect(repo.findOpenTaskIds).toHaveBeenCalledWith('ws_a')
    expect(events.find(e => e.id === 'e08_other_ws_old')!.prunedAt).toBeNull()

    // A second run is a no-op.
    const again = await hookEventRetentionService.pruneExpiredPayloads(NOW)
    expect(again.pruned).toBe(0)
  })

  it('pages through a backlog and stops at the per-run ceiling', async () => {
    events = Array.from({ length: 1200 }, (_, i) =>
      ev(`e${String(i).padStart(5, '0')}`, 200)
    )
    const result = await hookEventRetentionService.pruneExpiredPayloads(NOW)
    expect(result.pruned).toBe(1200)
    expect(repo.findExpiredEventIds).toHaveBeenCalledTimes(3)
  })

  it('treats an out-of-tier stored value as off', async () => {
    retention = [{ id: 'ws_a', hookEventRetentionDays: 7 }]
    events = [ev('e1', 400)]
    const result = await hookEventRetentionService.pruneExpiredPayloads(NOW)
    expect(result.pruned).toBe(0)
    expect(repo.findExpiredEventIds).not.toHaveBeenCalled()
  })
})

describe('hook event retention wiring (LUM-859)', () => {
  const OLD_SECRET = process.env.CRON_SECRET
  afterEach(() => {
    if (OLD_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = OLD_SECRET
  })

  it('hook event retention setting and cron wiring', async () => {
    // Setting: only off (null) or the four tiers.
    for (const v of [null, 30, 90, 180, 365]) {
      expect(
        updateWorkspaceSchema.safeParse({ hookEventRetentionDays: v }).success
      ).toBe(true)
    }
    for (const v of [0, 7, 60, 366, '30', -30]) {
      expect(
        updateWorkspaceSchema.safeParse({ hookEventRetentionDays: v }).success
      ).toBe(false)
    }

    // Default off: the column is nullable with no default.
    const schema = readFileSync(
      join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    )
    expect(schema).toMatch(/^\s*hookEventRetentionDays\s+Int\?\s*$/m)

    // OWNER-only, and the value reaches the repository.
    await expect(
      workspaceService.updateWorkspace('ws_a', 'MEMBER', 'slug', {
        hookEventRetentionDays: 30,
      })
    ).rejects.toMatchObject({ status: 403 })
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      hookEventRetentionDays: 180,
    })
    expect(workspaceRepository.update).toHaveBeenCalledWith('ws_a', {
      hookEventRetentionDays: 180,
      // LUM-933: a day tier is always a RETAIN choice.
      hookEventRetentionMode: 'RETAIN',
    })

    // Cron: registered in vercel.json and behind cron auth.
    const vercel = JSON.parse(
      readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')
    ) as { crons: { path: string }[] }
    expect(vercel.crons.map(c => c.path)).toContain(
      '/api/cron/prune-hook-event-payloads'
    )
    process.env.CRON_SECRET = 's3cret'
    const denied = await cronGET(
      new NextRequest('https://x.test/api/cron/prune-hook-event-payloads')
    )
    expect(denied.status).toBe(401)
    expect(repo.listWorkspacesWithRetention).not.toHaveBeenCalled()
    retention = []
    const ok = await cronGET(
      new NextRequest('https://x.test/api/cron/prune-hook-event-payloads', {
        headers: { authorization: 'Bearer s3cret' },
      })
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({
      workspaces: [],
      pruned: 0,
      prCommentDeadLetters: { purged: 0, capped: false },
      crossingRaw: { purged: 0, capped: false },
    })
  })
})
