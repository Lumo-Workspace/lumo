/**
 * @jest-environment node
 *
 * LUM-914 — the pre-rule retention stock (scan evidence from before LUM-911,
 * crossings dispositioned before LUM-912, dead letters from before LUM-913)
 * against a REAL Postgres (every migration replayed into PGlite). The plan
 * counts what the rule would process and writes nothing; an apply does what
 * the sweep does to those rows only, keeps metadata, honours --limit, and a
 * rerun processes 0. Data the sweeps own (post-rule rows) is never touched.
 *
 * LUM-1065: runs with the security plugin installed — the scan-evidence
 * category is the plugin's retention contributor. The core half (crossings,
 * dead letters, no plugin) is __tests__/services/retention-stock.real-postgres.test.ts.
 */
import { createPgliteHarness } from '../../../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { retentionStockService } from '@/lib/services/retention-stock.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'

jest.setTimeout(180_000)

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-20T03:45:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

const CODE = 'const token = req.query.t; db.exec(`select ${token}`)'
const COMMAND = "psql $DATABASE_URL -c 'drop table invoices cascade'"
const DIFF_HUNK = '@@ -1 +1 @@\n+const secret = process.env.API_KEY'

// The LUM-912 rollout: every workspace that existed then got this instant.
const ROLLOUT = ago(20)

function db() {
  return harness.prisma!
}

async function seedWorkspace(
  id: string,
  opts: {
    days: number
    scanDays?: number
    since?: Date
  }
) {
  await db().workspace.create({
    data: {
      id,
      name: id,
      slug: `slug-${id}`,
      scanEvidenceRetentionDays: opts.scanDays ?? Math.min(opts.days, 30),
      crossingRawRetentionDays: opts.days,
      crossingRawRetentionSince: opts.since ?? ROLLOUT,
      deadLetterRetentionDays: opts.days,
    },
  })
  await db().workspaceMember.create({
    data: { id: `m_${id}`, workspaceId: id, clerkId: `clerk_${id}` },
  })
  await db().team.create({
    data: {
      id: `team_${id}`,
      workspaceId: id,
      name: id,
      identifier: id.toUpperCase().slice(-3),
    },
  })
  await db().project.create({
    data: {
      id: `proj_${id}`,
      workspaceId: id,
      teamId: `team_${id}`,
      createdByMemberId: `m_${id}`,
      name: id,
    },
  })
  await db().task.create({
    data: {
      id: `task_${id}`,
      projectId: `proj_${id}`,
      workspaceId: id,
      teamId: `team_${id}`,
      number: 1,
      title: 'retention stock',
    },
  })
}

let prNumber = 0

async function seedScan(
  id: string,
  ws: string,
  opts: {
    prState: 'open' | 'merged' | 'closed'
    prEndedAt?: Date
    finishedAt: Date
    status?: 'CLEAN' | 'FINDINGS' | 'FAILED' | 'RUNNING'
    tracked?: boolean
    scrubbedAt?: Date
  }
) {
  const number = ++prNumber
  await db().pullRequest.create({
    data: {
      id: `pr_${id}`,
      workspaceId: ws,
      repo: 'acme/app',
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/app/pull/${number}`,
      state: opts.prState,
      mergedAt: opts.prState === 'merged' ? (opts.prEndedAt ?? null) : null,
      closedAt: opts.prState === 'closed' ? (opts.prEndedAt ?? null) : null,
      authorLogin: 'octo',
      headBranch: 'feature',
      baseBranch: 'main',
    },
  })
  await db().prSecurityScan.create({
    data: {
      id,
      pullRequestId: `pr_${id}`,
      workspaceId: ws,
      headSha: 'abc',
      trigger: 'PR_EVENT',
      detectorVersion: 'test',
      status: opts.status ?? 'FINDINGS',
      stages: { judge: 'RAN', hunt: 'RAN' },
      startedAt: new Date(opts.finishedAt.getTime() - 60_000),
      finishedAt: opts.status === 'RUNNING' ? null : opts.finishedAt,
      retentionTracked: opts.tracked ?? false,
      codeScrubbedAt: opts.scrubbedAt ?? null,
      prSummary: { description: CODE },
      huntAudit: {
        candidates: 3,
        planned: [{ category: 'injection', objective: CODE }],
      },
      huntJob: { signalSites: [CODE] },
    },
  })
  await db().prSecurityFinding.create({
    data: {
      id: `${id}_f`,
      scanId: id,
      kind: 'VULNERABILITY',
      ruleId: 'vuln:sql-injection',
      severity: 'HIGH',
      provenance: 'LLM_JUDGE',
      filePath: 'src/db.ts',
      title: `SQL injection in ${CODE}`,
      detail: CODE,
      evidence: CODE,
      callChain: [{ from: CODE, to: 'db.exec' }],
      suggestedReason: CODE,
      fingerprint: `${id}_fp`,
    },
  })
}

async function seedCrossing(
  id: string,
  ws: string,
  opts: {
    dispositionedAt: Date | null
    disposition?: 'CONFIRMED' | 'FALSE_POSITIVE' | null
  }
) {
  const disposition =
    opts.disposition === undefined ? 'CONFIRMED' : opts.disposition
  await db().boundaryCrossing.create({
    data: {
      id,
      taskId: `task_${ws}`,
      category: 'DESTRUCTIVE_DB_COMMAND',
      detail: `Ran ${COMMAND}`,
      target: COMMAND,
      systemExplanation: `The agent dropped a table: ${COMMAND}`,
      ...(disposition ? { disposition, dispositionNote: 'ruled by hand' } : {}),
      dispositionedAt: opts.dispositionedAt,
      explanations: { create: [{ note: `I ran ${COMMAND} on purpose` }] },
    },
  })
  await db().taskActivity.create({
    data: {
      taskId: `task_${ws}`,
      type: 'BOUNDARY_CROSSING_DETECTED',
      payload: {
        boundaryCrossingId: id,
        category: 'DESTRUCTIVE_DB_COMMAND',
        detail: `Ran ${COMMAND}`,
      },
    },
  })
}

async function seedDeadLetter(
  id: string,
  ws: string,
  opts: {
    updatedAt: Date
    deadLetteredAt?: Date
    status?: 'DEAD_LETTER' | 'PENDING'
    direction?: 'INBOUND' | 'OUTBOUND'
  }
) {
  await db().prCommentSyncJob.create({
    data: {
      id,
      direction: opts.direction ?? 'INBOUND',
      payload: {
        reason: 'parent-mirror-missing',
        commentId: `c_${id}`,
        pullRequestId: 'pr_x',
        raw: {
          action: 'created',
          comment: { id: 1, body: 'please fix', diff_hunk: DIFF_HUNK },
          pull_request: { number: 42 },
          repository: { full_name: 'acme/app' },
        },
      },
      workspaceId: ws,
      status: opts.status ?? 'DEAD_LETTER',
      attempts: 3,
      lastError: 'parent mirror still missing',
      deadLetteredAt: opts.deadLetteredAt ?? null,
      createdAt: opts.updatedAt,
      updatedAt: opts.updatedAt,
    },
  })
}

/** Everything the stock script could write, as one comparable string. */
async function snapshot(): Promise<Record<string, string>> {
  const order = { orderBy: { id: 'asc' as const } }
  return {
    scans: JSON.stringify(await db().prSecurityScan.findMany(order)),
    findings: JSON.stringify(await db().prSecurityFinding.findMany(order)),
    crossings: JSON.stringify(await db().boundaryCrossing.findMany(order)),
    explanations: JSON.stringify(
      await db().boundaryCrossingExplanation.findMany(order)
    ),
    activities: JSON.stringify(await db().taskActivity.findMany(order)),
    jobs: JSON.stringify(await db().prCommentSyncJob.findMany(order)),
    workspaces: JSON.stringify(await db().workspace.findMany(order)),
  }
}

async function rowsById<T extends { id: string }>(
  rows: Promise<T[]>
): Promise<Map<string, string>> {
  return new Map((await rows).map(r => [r.id, JSON.stringify(r)]))
}

async function seedAll() {
  // ws_a: 7-day tiers. ws_b: 30 days. ws_c: shortened 30 → 7 five days ago.
  await seedWorkspace('ws_a', { days: 7 })
  await seedWorkspace('ws_b', { days: 30 })
  await seedWorkspace('ws_c', { days: 7, since: ago(5) })

  // Scans — pre-LUM-911 (untracked) unless said otherwise.
  await seedScan('s_pr_ended', 'ws_a', {
    prState: 'merged',
    prEndedAt: ago(10),
    finishedAt: ago(12),
  })
  await seedScan('s_hard_cap', 'ws_a', { prState: 'open', finishedAt: ago(40) })
  await seedScan('s_closed_b', 'ws_b', {
    prState: 'closed',
    prEndedAt: ago(45),
    finishedAt: ago(29),
  })
  await seedScan('s_open_recent', 'ws_a', {
    prState: 'open',
    finishedAt: ago(10),
  })
  await seedScan('s_b_in_window', 'ws_b', {
    prState: 'merged',
    prEndedAt: ago(10),
    finishedAt: ago(12),
  })
  await seedScan('s_running', 'ws_a', {
    prState: 'merged',
    prEndedAt: ago(10),
    finishedAt: ago(12),
    status: 'RUNNING',
  })
  await seedScan('s_tracked', 'ws_a', {
    prState: 'merged',
    prEndedAt: ago(10),
    finishedAt: ago(12),
    tracked: true,
  })
  await seedScan('s_scrubbed', 'ws_a', {
    prState: 'merged',
    prEndedAt: ago(10),
    finishedAt: ago(12),
    scrubbedAt: ago(1),
  })

  // Crossings.
  await seedCrossing('c_a_old', 'ws_a', { dispositionedAt: ago(30) })
  await seedCrossing('c_a_fp', 'ws_a', {
    dispositionedAt: ago(60),
    disposition: 'FALSE_POSITIVE',
  })
  await seedCrossing('c_a_no_time', 'ws_a', { dispositionedAt: null })
  await seedCrossing('c_a_post', 'ws_a', { dispositionedAt: ago(10) })
  await seedCrossing('c_a_open', 'ws_a', {
    dispositionedAt: null,
    disposition: null,
  })
  await seedCrossing('c_b_in_window', 'ws_b', { dispositionedAt: ago(25) })
  await seedCrossing('c_b_old', 'ws_b', { dispositionedAt: ago(40) })
  await seedCrossing('c_c_longer', 'ws_c', { dispositionedAt: ago(10) })
  await seedCrossing('c_c_old', 'ws_c', { dispositionedAt: ago(30) })

  // Dead letters.
  await seedDeadLetter('d_a_old', 'ws_a', { updatedAt: ago(40) })
  await seedDeadLetter('d_a_out', 'ws_a', {
    updatedAt: ago(100),
    direction: 'OUTBOUND',
  })
  await seedDeadLetter('d_a_recent', 'ws_a', { updatedAt: ago(3) })
  await seedDeadLetter('d_b_in_window', 'ws_b', { updatedAt: ago(20) })
  await seedDeadLetter('d_b_old', 'ws_b', { updatedAt: ago(100) })
  await seedDeadLetter('d_tracked', 'ws_a', {
    updatedAt: ago(40),
    deadLetteredAt: ago(40),
  })
  await seedDeadLetter('d_pending', 'ws_a', {
    updatedAt: ago(40),
    status: 'PENDING',
  })
}

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await db().prCommentSyncJob.deleteMany({})
  await db().taskActivity.deleteMany({})
  await db().boundaryCrossingExplanation.deleteMany({})
  await db().boundaryCrossing.deleteMany({})
  await db().prSecurityFinding.deleteMany({})
  await db().prSecurityScan.deleteMany({})
  await db().pullRequest.deleteMany({})
  await db().task.deleteMany({})
  await db().project.deleteMany({})
  await db().team.deleteMany({})
  await db().workspaceMember.deleteMany({})
  await db().workspace.deleteMany({})
  await seedAll()
})

describe('LUM-914 retention stock', () => {
  it('stock dry run counts each category by the current rules and writes nothing', async () => {
    const before = await snapshot()

    const scans = await retentionStockService.plan('scan-evidence', {
      now: NOW,
    })
    expect(scans.due).toBe(3)
    expect(scans.byReason).toEqual({ pr_ended: 2, hard_cap: 1 })
    expect(scans.byWorkspace).toEqual({ ws_a: 2, ws_b: 1 })
    expect(scans.findings).toBe(3)
    // s_b_in_window (30-day tier) is read and held; the open-recent and the
    // running scan are never candidates.
    expect(scans.held).toEqual({ not_due_yet: 1, not_final_or_open_pr: 2 })
    expect(scans.oldest?.getTime()).toBe(ago(40).getTime())
    expect(scans.newest?.getTime()).toBe(ago(12).getTime())

    const crossings = await retentionStockService.plan('crossing-raw', {
      now: NOW,
    })
    expect(crossings.rolloutAt?.getTime()).toBe(ROLLOUT.getTime())
    expect(crossings.due).toBe(4)
    expect(crossings.byReason).toEqual({
      'disposition:CONFIRMED': 3,
      'disposition:FALSE_POSITIVE': 1,
    })
    expect(crossings.byWorkspace).toEqual({ ws_a: 2, ws_b: 1, ws_c: 1 })
    expect(crossings.held).toEqual({
      no_disposition_time: 1,
      within_window: 1,
      ruled_under_longer_window: 1,
    })
    expect(crossings.oldest?.getTime()).toBe(ago(60).getTime())
    expect(crossings.newest?.getTime()).toBe(ago(30).getTime())

    const letters = await retentionStockService.plan('dead-letter', {
      now: NOW,
    })
    expect(letters.due).toBe(3)
    expect(letters.byReason).toEqual({
      'INBOUND · 31-90d': 1,
      'OUTBOUND · >90d': 1,
      'INBOUND · >90d': 1,
    })
    expect(letters.byWorkspace).toEqual({ ws_a: 2, ws_b: 1 })
    expect(letters.held).toEqual({ within_window: 2 })

    // The report names workspaces by slug.
    expect(await workspaceRepository.findSlugs(['ws_a', 'ws_b'])).toEqual(
      new Map([
        ['ws_a', 'slug-ws_a'],
        ['ws_b', 'slug-ws_b'],
      ])
    )

    // Read-only: not one column of any table moved.
    expect(await snapshot()).toEqual(before)
  })

  it('stock apply scrubs due pre-rule scans only and keeps their metadata', async () => {
    const crossingsBefore = (await snapshot()).crossings
    const jobsBefore = (await snapshot()).jobs
    const untouched = await rowsById(
      db().prSecurityScan.findMany({
        where: {
          id: {
            in: [
              's_open_recent',
              's_b_in_window',
              's_running',
              's_tracked',
              's_scrubbed',
            ],
          },
        },
      })
    )

    const result = await retentionStockService.apply('scan-evidence', {
      now: NOW,
    })
    expect(result).toMatchObject({ processed: 3, findings: 3 })

    for (const id of ['s_pr_ended', 's_hard_cap', 's_closed_b']) {
      const scan = await db().prSecurityScan.findUniqueOrThrow({
        where: { id },
      })
      expect(scan.codeScrubbedAt).not.toBeNull()
      expect(scan.prSummary).toBeNull()
      expect(scan.huntJob).toBeNull()
      // The hunt audit keeps its counts, not its text.
      expect(scan.huntAudit).toEqual({
        candidates: 3,
        planned: [{ category: 'injection' }],
      })
      // Metadata stays: status, still untracked (the sweep never adopts it).
      expect(scan.status).toBe('FINDINGS')
      expect(scan.retentionTracked).toBe(false)
      const finding = await db().prSecurityFinding.findUniqueOrThrow({
        where: { id: `${id}_f` },
      })
      expect(JSON.stringify(finding)).not.toContain('req.query.t')
      expect(finding).toMatchObject({
        title: 'vuln:sql-injection',
        ruleId: 'vuln:sql-injection',
        severity: 'HIGH',
        filePath: 'src/db.ts',
        fingerprint: `${id}_fp`,
      })
    }
    // Held, post-rule and already-scrubbed scans: byte-identical.
    expect(
      await rowsById(
        db().prSecurityScan.findMany({
          where: { id: { in: [...untouched.keys()] } },
        })
      )
    ).toEqual(untouched)
    expect(await db().prSecurityScan.count()).toBe(8)
    // Other categories untouched.
    expect((await snapshot()).crossings).toBe(crossingsBefore)
    expect((await snapshot()).jobs).toBe(jobsBefore)
  })

  it('stock apply purges due pre-rollout crossings and keeps the ruling', async () => {
    const scansBefore = (await snapshot()).scans
    const jobsBefore = (await snapshot()).jobs
    const heldIds = [
      'c_a_no_time',
      'c_a_post',
      'c_a_open',
      'c_b_in_window',
      'c_c_longer',
    ]
    const held = await rowsById(
      db().boundaryCrossing.findMany({ where: { id: { in: heldIds } } })
    )

    const result = await retentionStockService.apply('crossing-raw', {
      now: NOW,
    })
    expect(result.processed).toBe(4)

    for (const id of ['c_a_old', 'c_a_fp', 'c_b_old', 'c_c_old']) {
      const c = await db().boundaryCrossing.findUniqueOrThrow({
        where: { id },
        include: { explanations: true },
      })
      expect(c.rawPurgedAt?.getTime()).toBe(NOW.getTime())
      expect(c.detail).toBe('DESTRUCTIVE_DB_COMMAND · $ psql …')
      expect(c.target).toMatch(/^sha256:[0-9a-f]{32}$/)
      expect(c.systemExplanation).toBeNull()
      expect(c.explanations.map(e => e.note)).toEqual([''])
      expect(c.disposition).not.toBeNull()
      expect(c.dispositionNote).toBe('ruled by hand')
      const activity = await db().taskActivity.findFirstOrThrow({
        where: { payload: { path: ['boundaryCrossingId'], equals: id } },
      })
      expect(JSON.stringify(activity.payload)).not.toContain('drop table')
    }
    expect(
      await rowsById(
        db().boundaryCrossing.findMany({ where: { id: { in: heldIds } } })
      )
    ).toEqual(held)
    expect((await snapshot()).scans).toBe(scansBefore)
    expect((await snapshot()).jobs).toBe(jobsBefore)
  })

  it('stock apply drops pre-LUM-913 dead letter payloads and keeps metadata', async () => {
    const crossingsBefore = (await snapshot()).crossings
    const heldIds = ['d_a_recent', 'd_b_in_window', 'd_tracked', 'd_pending']
    const held = await rowsById(
      db().prCommentSyncJob.findMany({ where: { id: { in: heldIds } } })
    )

    const result = await retentionStockService.apply('dead-letter', {
      now: NOW,
    })
    expect(result.processed).toBe(3)

    for (const id of ['d_a_old', 'd_a_out', 'd_b_old']) {
      const job = await db().prCommentSyncJob.findUniqueOrThrow({
        where: { id },
      })
      expect(job.payloadPurgedAt?.getTime()).toBe(NOW.getTime())
      expect(JSON.stringify(job.payload)).not.toContain('API_KEY')
      expect(job.payload).toMatchObject({
        rawPurged: true,
        reason: 'parent-mirror-missing',
        repo: 'acme/app',
        prNumber: 42,
      })
      expect(job.status).toBe('DEAD_LETTER')
      expect(job.deadLetteredAt).toBeNull()
      expect(job.lastError).toBe('parent mirror still missing')
    }
    expect(
      await rowsById(
        db().prCommentSyncJob.findMany({ where: { id: { in: heldIds } } })
      )
    ).toEqual(held)
    expect(await db().prCommentSyncJob.count()).toBe(7)
    expect((await snapshot()).crossings).toBe(crossingsBefore)
  })

  it('stock apply is idempotent: a rerun processes 0 rows', async () => {
    for (const category of [
      'scan-evidence',
      'crossing-raw',
      'dead-letter',
    ] as const) {
      const first = await retentionStockService.apply(category, { now: NOW })
      expect(first.processed).toBeGreaterThan(0)
      const afterFirst = await snapshot()
      const second = await retentionStockService.apply(category, { now: NOW })
      expect(second.processed).toBe(0)
      expect(await snapshot()).toEqual(afterFirst)
      expect(
        (await retentionStockService.plan(category, { now: NOW })).due
      ).toBe(0)
    }
  })

  it('stock apply honours limit and batch size', async () => {
    const batches: number[] = []
    const first = await retentionStockService.apply('crossing-raw', {
      now: NOW,
      limit: 3,
      batchSize: 2,
      onBatch: p => batches.push(p.processed),
    })
    expect(first.processed).toBe(3)
    expect(batches).toEqual([2, 3])
    expect(
      (await retentionStockService.plan('crossing-raw', { now: NOW })).due
    ).toBe(1)

    const letters = await retentionStockService.apply('dead-letter', {
      now: NOW,
      limit: 1,
    })
    expect(letters.processed).toBe(1)
    expect(
      await db().prCommentSyncJob.count({
        where: { payloadPurgedAt: { not: null } },
      })
    ).toBe(1)

    const scans = await retentionStockService.apply('scan-evidence', {
      now: NOW,
      limit: 2,
      batchSize: 1,
    })
    expect(scans.processed).toBe(2)
    expect(
      (await retentionStockService.plan('scan-evidence', { now: NOW })).due
    ).toBe(1)
  })
})
