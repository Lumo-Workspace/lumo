/**
 * @jest-environment node
 *
 * LUM-913 — a dead-lettered PR comment sync job drops its GitHub webhook
 * payload (`payload.raw`, which carries comment text and `diff_hunk`) 7 days
 * after entering DEAD_LETTER, against a REAL Postgres (every migration
 * replayed into PGlite). Dead letters from before LUM-913 (no
 * `deadLetteredAt`) are never touched by the automatic purge.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import {
  prCommentDeadLetterRetentionService,
  DEAD_LETTER_PURGE_BATCH_SIZE,
} from '@/lib/services/pr-comment-dead-letter-retention.service'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

jest.setTimeout(180_000)

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-20T03:45:00Z')
const WORKSPACE = 'ws_dead_letters'
const DIFF_HUNK = '@@ -1,3 +1,4 @@\n+const secret = process.env.API_KEY'

// The exact shape pr-comment-mirror.service enqueues for its only INBOUND
// job (parent-mirror-missing retry): no top-level event / action / task —
// those exist only inside `raw`, the GitHub webhook body.
function inboundPayload(n: number) {
  return {
    reason: 'parent-mirror-missing',
    commentId: `comment_${n}`,
    pullRequestId: 'pr_1',
    raw: {
      action: 'created',
      comment: { id: 1000 + n, body: 'please fix', diff_hunk: DIFF_HUNK },
      pull_request: { number: 42, title: 'Add API client' },
      repository: { full_name: 'acme/app' },
    },
  }
}

async function seedDeadLetter(
  id: string,
  deadLetteredAt: Date | null,
  n = 0
): Promise<void> {
  await harness.prisma!.prCommentSyncJob.create({
    data: {
      id,
      direction: 'INBOUND',
      payload: inboundPayload(n),
      externalId: String(1000 + n),
      workspaceId: WORKSPACE,
      status: 'DEAD_LETTER',
      attempts: 3,
      lastError: 'parent mirror still missing',
      deadLetteredAt,
      createdAt: deadLetteredAt ?? new Date(NOW.getTime() - 400 * DAY),
      updatedAt: deadLetteredAt ?? new Date(NOW.getTime() - 400 * DAY),
    },
  })
}

async function job(id: string) {
  return harness.prisma!.prCommentSyncJob.findUniqueOrThrow({ where: { id } })
}

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  const db = harness.prisma!
  await db.prCommentSyncJob.deleteMany({})
  await db.workspace.upsert({
    where: { id: WORKSPACE },
    create: { id: WORKSPACE, name: WORKSPACE, slug: WORKSPACE },
    update: {},
  })
})

describe('PR comment dead-letter payload retention', () => {
  it('markDeadLetter stamps when the job entered DEAD_LETTER', async () => {
    await harness.prisma!.prCommentSyncJob.create({
      data: {
        id: 'job_pending',
        direction: 'INBOUND',
        payload: inboundPayload(0),
        workspaceId: WORKSPACE,
      },
    })
    const before = Date.now()
    await prCommentSyncJobRepository.markDeadLetter('job_pending', 'boom')
    const row = await job('job_pending')
    expect(row.status).toBe('DEAD_LETTER')
    expect(row.deadLetteredAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('dead letter younger than 7 days keeps its raw payload', async () => {
    await seedDeadLetter('job_fresh', new Date(NOW.getTime() - 6.9 * DAY))
    const result =
      await prCommentDeadLetterRetentionService.purgeExpiredPayloads(NOW)
    expect(result.purged).toBe(0)
    const row = await job('job_fresh')
    expect(row.payload).toEqual(inboundPayload(0))
    expect(row.payloadPurgedAt).toBeNull()
  })

  it('dead letter older than 7 days loses raw payload but keeps troubleshooting metadata', async () => {
    const deadLetteredAt = new Date(NOW.getTime() - 7 * DAY - 60_000)
    await seedDeadLetter('job_old', deadLetteredAt)
    const wallClockBeforePurge = Date.now()
    const result =
      await prCommentDeadLetterRetentionService.purgeExpiredPayloads(NOW)
    expect(result).toEqual({ purged: 1, capped: false })

    const row = await job('job_old')
    expect(JSON.stringify(row.payload)).not.toContain('diff_hunk')
    expect(JSON.stringify(row.payload)).not.toContain('process.env.API_KEY')
    expect(JSON.stringify(row.payload)).not.toContain('please fix')
    // event / action are recovered from raw before it is dropped.
    expect(row.payload).toEqual({
      rawPurged: true,
      reason: 'parent-mirror-missing',
      event: 'pull_request_review_comment',
      action: 'created',
      pullRequestId: 'pr_1',
      commentId: 'comment_0',
      repo: 'acme/app',
      prNumber: 42,
    })
    expect(row.payloadPurgedAt).toEqual(NOW)
    // Troubleshooting columns are untouched, including the two timestamps
    // that date the failure.
    expect(row.status).toBe('DEAD_LETTER')
    expect(row.lastError).toBe('parent mirror still missing')
    expect(row.createdAt).toEqual(deadLetteredAt)
    expect(row.deadLetteredAt).toEqual(deadLetteredAt)
    // updatedAt is NOT preserved: the purge is a row update and Prisma's
    // @updatedAt stamps it with the wall-clock time of the purge (not `NOW`).
    expect(row.updatedAt).not.toEqual(deadLetteredAt)
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(
      wallClockBeforePurge - 1000
    )
    expect(row.externalId).toBe('1000')
    expect(row.attempts).toBe(3)
  })

  it('dead letters from before deploy are left untouched', async () => {
    // No deadLetteredAt: dead-lettered before LUM-913 shipped, however old.
    await seedDeadLetter('job_legacy', null)
    const result =
      await prCommentDeadLetterRetentionService.purgeExpiredPayloads(NOW)
    expect(result.purged).toBe(0)
    const row = await job('job_legacy')
    expect(row.payload).toEqual(inboundPayload(0))
    expect(row.payloadPurgedAt).toBeNull()
  })

  it('leaves pending jobs alone', async () => {
    await harness.prisma!.prCommentSyncJob.create({
      data: {
        id: 'job_retrying',
        direction: 'INBOUND',
        payload: inboundPayload(0),
        workspaceId: WORKSPACE,
        attempts: 2,
        createdAt: new Date(NOW.getTime() - 30 * DAY),
      },
    })
    await prCommentDeadLetterRetentionService.purgeExpiredPayloads(NOW)
    expect((await job('job_retrying')).payload).toEqual(inboundPayload(0))
  })

  it('prune clears a multi batch backlog and a rerun is a no-op', async () => {
    const total = DEAD_LETTER_PURGE_BATCH_SIZE * 2 + 17
    const old = new Date(NOW.getTime() - 10 * DAY)
    await harness.prisma!.prCommentSyncJob.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        id: `job_bulk_${String(i).padStart(4, '0')}`,
        direction: 'INBOUND' as const,
        payload: inboundPayload(i),
        workspaceId: WORKSPACE,
        status: 'DEAD_LETTER' as const,
        attempts: 3,
        lastError: 'boom',
        deadLetteredAt: old,
      })),
    })

    const first =
      await prCommentDeadLetterRetentionService.purgeExpiredPayloads(NOW)
    expect(first).toEqual({ purged: total, capped: false })
    const rows = await harness.prisma!.prCommentSyncJob.findMany({
      select: { payload: true, payloadPurgedAt: true },
    })
    expect(rows).toHaveLength(total)
    expect(
      rows.filter(r => JSON.stringify(r.payload).includes('diff_hunk'))
    ).toHaveLength(0)

    const later = new Date(NOW.getTime() + DAY)
    const second =
      await prCommentDeadLetterRetentionService.purgeExpiredPayloads(later)
    expect(second).toEqual({ purged: 0, capped: false })
    const after = await harness.prisma!.prCommentSyncJob.findMany({
      select: { payloadPurgedAt: true },
    })
    // The first run's timestamps stand; the rerun rewrote nothing.
    expect(
      after.every(r => r.payloadPurgedAt?.getTime() === NOW.getTime())
    ).toBe(true)
  })
})
