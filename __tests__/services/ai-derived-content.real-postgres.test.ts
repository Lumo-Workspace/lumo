/**
 * @jest-environment node
 *
 * LUM-917 — AI-derived content against a REAL Postgres (every migration
 * replayed into PGlite):
 *   - the OWNER delete removes the workspace's memories (embedding included,
 *     with the FK-less rows naming them) and clears session / run summaries,
 *     in batches, idempotently, without touching another workspace or the
 *     session record itself;
 *   - memory, session summary and run summary writes store no code.
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

// Manual memory adds: no model calls in this suite (identity canonicalize,
// no embedding, no repo constitution).
jest.mock('@/lib/services/memory/canonicalize-language', () => ({
  canonicalizeToEnglish: async (_c: unknown, content: unknown) => content,
}))
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: async () => {
    throw new Error('no embedding in this suite')
  },
}))
jest.mock('@/lib/services/memory/constitution', () => ({
  loadConstitutionSource: async () => ({ text: null, repo: null }),
  loadConstitutionText: async () => null,
}))

import { memoryManagementService } from '@/lib/services/memory-management.service'
import { aiDerivedContentRepository } from '@/lib/repositories/ai-derived-content.repository'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { CODE_OMITTED_MARKER } from '@/lib/ai-derived/strip-code'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { taskClaimSnapshotService } from '@/lib/services/task-claim-snapshot.service'

jest.setTimeout(180_000)

const WS = 'ws_ai_derived'
const OTHER = 'ws_ai_other'
const FENCE = '```'
const SNIPPET = [
  `${FENCE}ts`,
  'export async function loadTask(id: string) {',
  '  return prisma.task.findUnique({ where: { id } })',
  '}',
  FENCE,
].join('\n')

function db() {
  return harness.prisma!
}

async function seedWorkspace(id: string) {
  await db().workspace.create({ data: { id, name: `${id} name`, slug: id } })
  await db().workspaceMember.create({
    data: { id: `${id}_member`, workspaceId: id, clerkId: `${id}_clerk` },
  })
  await db().team.create({
    data: { id: `${id}_team`, workspaceId: id, name: id, identifier: 'AD' },
  })
  await db().project.create({
    data: {
      id: `${id}_project`,
      workspaceId: id,
      teamId: `${id}_team`,
      createdByMemberId: `${id}_member`,
      name: id,
    },
  })
}

async function seedMemory(ws: string, text: string): Promise<string> {
  const { id } = await memoryRepository.create({
    workspaceId: ws,
    projectId: `${ws}_project`,
    taskId: null,
    scope: 'PROJECT',
    category: 'CONVENTION',
    content: { rule: text, scope: 'repo' },
    sourceSessionId: null,
    createdByMemberId: null,
  })
  return id
}

async function seedSession(ws: string, id: string) {
  await db().session.create({
    data: {
      id,
      workspaceId: ws,
      workspaceMemberId: `${ws}_member`,
      lastActivityAt: new Date('2026-10-01T00:00:00Z'),
      summary: { type: 'exploration', whatExplored: 'the retry loop' },
      summaryType: 'exploration',
      summaryGeneratedAt: new Date('2026-10-01T01:00:00Z'),
      summaryClassifyModel: 'classify-model',
      summaryContentModel: 'content-model',
      summaryEventCount: 12,
      runSummary: 'Fixed the retry loop.',
      runSummaryGeneratedAt: new Date('2026-10-01T02:00:00Z'),
    },
  })
  await db().hookEvent.create({
    data: {
      id: `${id}_event`,
      workspaceId: ws,
      workspaceMemberId: `${ws}_member`,
      sessionId: id,
      type: 'STOP',
      payload: { note: 'session record stays' },
    },
  })
}

let taskNumber = 100
const SNAPSHOT_AT = new Date('2026-10-01T03:00:00Z')
const TASK_UPDATED_AT = new Date('2026-09-20T00:00:00Z')

async function seedClaimTask(
  ws: string,
  id: string,
  source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST'
) {
  await db().task.create({
    data: {
      id,
      projectId: `${ws}_project`,
      workspaceId: ws,
      teamId: `${ws}_team`,
      number: ++taskNumber,
      title: id,
      status: 'DONE',
      claimSnapshot: `${source} claim text`,
      claimSnapshotSource: source,
      claimSnapshotSessionId: 'some_session',
      claimSnapshotAt: SNAPSHOT_AT,
      updatedAt: TASK_UPDATED_AT,
    },
  })
}

async function seedVerdict(taskId: string) {
  await db().claimFaithfulnessVerdict.create({
    data: {
      taskId,
      verdict: 'UNDERREPORT',
      evidence: [{ quote: 'the diff touched lib/a.ts' }],
      reasoning: 'The claim leaves out the migration.',
      judgeModel: 'judge-model',
      judgedClaimAt: SNAPSHOT_AT,
    },
  })
}

beforeAll(async () => {
  await harness.start()
  await seedWorkspace(WS)
  await seedWorkspace(OTHER)
})

afterAll(async () => {
  await harness.stop()
})

describe('AI-derived content writes store no code (LUM-917)', () => {
  it('memory create strips a pasted code block but keeps prose byte-identical', async () => {
    const dirtyId = await seedMemory(
      WS,
      `Load tasks through the repository.\n${SNIPPET}`
    )
    const cleanText = 'Run `npm run i18n:sync` after editing lib/i18n/en.json.'
    const cleanId = await seedMemory(WS, cleanText)

    const dirty = await db().memory.findUniqueOrThrow({
      where: { id: dirtyId },
    })
    const stored = JSON.stringify(dirty.content)
    expect(stored).not.toContain(FENCE)
    expect(stored).not.toContain('findUnique')
    expect(dirty.content).toEqual({
      rule: `Load tasks through the repository.\n${CODE_OMITTED_MARKER}`,
      scope: 'repo',
    })

    const clean = await db().memory.findUniqueOrThrow({
      where: { id: cleanId },
    })
    expect(clean.content).toEqual({ rule: cleanText, scope: 'repo' })
  })

  it('memory content update strips code too', async () => {
    const id = await seedMemory(WS, 'Prose only.')
    await memoryRepository.updateContent(id, {
      rule: `Changed.\n${SNIPPET}`,
      scope: 'repo',
    })
    const row = await db().memory.findUniqueOrThrow({ where: { id } })
    expect(JSON.stringify(row.content)).not.toContain('findUnique')
  })

  it('run summary and session summary writes strip code', async () => {
    await seedSession(WS, 's_write')
    await sessionRepository.setRunSummary(
      's_write',
      `The run rewrote the loader.\n${SNIPPET}`,
      new Date('2026-10-02T00:00:00Z')
    )
    await sessionRepository.updateSummary({
      id: 's_write',
      summary: {
        type: 'implementation',
        whatBuilt: 'A loader',
        keyChanges: [`Added ${FENCE}\nconst a = await load(id);\n${FENCE}`],
      },
      summaryType: 'implementation',
      generatedAt: new Date('2026-10-02T00:00:00Z'),
      classifyModel: null,
      contentModel: 'content-model',
      eventCount: 3,
    })
    const row = await db().session.findUniqueOrThrow({
      where: { id: 's_write' },
      select: { runSummary: true, summary: true },
    })
    expect(row.runSummary).toBe(
      `The run rewrote the loader.\n${CODE_OMITTED_MARKER}`
    )
    expect(JSON.stringify(row.summary)).not.toContain('await load')
    expect(row.summary).toMatchObject({
      keyChanges: [`Added\n${CODE_OMITTED_MARKER}`],
    })
  })
})

describe('hand-added memories (LUM-917 ruling)', () => {
  it('are still accepted with the switch off, and code is stripped', async () => {
    const MANUAL = 'ws_ai_manual'
    await seedWorkspace(MANUAL)
    await db().workspace.update({
      where: { id: MANUAL },
      data: { aiDerivedContentEnabled: false },
    })
    const out = await memoryManagementService.createForProject({
      projectId: `${MANUAL}_project`,
      workspaceId: MANUAL,
      category: 'CONVENTION',
      content: {
        rule: `Load tasks through the repository.\n${SNIPPET}`,
        scope: 'lib/repositories',
      },
      actorMemberId: `${MANUAL}_member`,
    })
    expect(out.outcome).toBe('ADD')
    const row = await db().memory.findUniqueOrThrow({
      where: { id: out.memory.id },
    })
    expect(row.createdByMemberId).toBe(`${MANUAL}_member`)
    expect(row.content).toEqual({
      rule: `Load tasks through the repository.\n${CODE_OMITTED_MARKER}`,
      scope: 'lib/repositories',
    })
  })
})

describe('claim snapshot with AI-derived content off (LUM-917)', () => {
  it('DONE freezes no DIGEST claim from turn summaries; switch on still does', async () => {
    const OFF = 'ws_ai_claim_off'
    const ON = 'ws_ai_claim_on'
    for (const ws of [OFF, ON]) {
      await seedWorkspace(ws)
      await db().task.create({
        data: {
          id: `${ws}_task`,
          projectId: `${ws}_project`,
          workspaceId: ws,
          teamId: `${ws}_team`,
          number: 1,
          title: 'claim',
          status: 'DONE',
        },
      })
      await db().session.create({
        data: {
          id: `${ws}_session`,
          workspaceId: ws,
          workspaceMemberId: `${ws}_member`,
          taskId: `${ws}_task`,
          lastActivityAt: new Date('2026-10-02T00:00:00Z'),
        },
      })
      await db().hookEvent.create({
        data: {
          workspaceId: ws,
          workspaceMemberId: `${ws}_member`,
          sessionId: `${ws}_session`,
          taskId: `${ws}_task`,
          type: 'STOP',
          payload: {},
          turnSummary: 'Edited the loader.',
        },
      })
    }
    await db().workspace.update({
      where: { id: OFF },
      data: { aiDerivedContentEnabled: false },
    })

    await taskClaimSnapshotService.synthesizeForTask(`${OFF}_task`)
    await taskClaimSnapshotService.synthesizeForTask(`${ON}_task`)

    const off = await db().task.findUniqueOrThrow({
      where: { id: `${OFF}_task` },
    })
    expect(off.claimSnapshot).toBeNull()
    expect(off.claimSnapshotSource).toBeNull()
    expect(off.claimSnapshotAt).not.toBeNull()

    const on = await db().task.findUniqueOrThrow({
      where: { id: `${ON}_task` },
    })
    expect(on.claimSnapshot).toBe('Edited the loader.')
    expect(on.claimSnapshotSource).toBe('DIGEST')
  })
})

describe('turn summary writes store no code (LUM-917)', () => {
  it('setTurnSummary strips a code block from the stored turn summary', async () => {
    await seedSession(WS, 's_turn')
    await hookEventRepository.setTurnSummary(
      's_turn_event',
      `Rewrote the loader.\n${SNIPPET}`
    )
    const event = await db().hookEvent.findUniqueOrThrow({
      where: { id: 's_turn_event' },
      select: { turnSummary: true },
    })
    expect(event.turnSummary).toBe(
      `Rewrote the loader.\n${CODE_OMITTED_MARKER}`
    )
    expect(event.turnSummary).not.toContain(FENCE)

    await hookEventRepository.setTurnSummary('s_turn_event', 'Ran the tests.')
    const plain = await db().hookEvent.findUniqueOrThrow({
      where: { id: 's_turn_event' },
      select: { turnSummary: true },
    })
    expect(plain.turnSummary).toBe('Ran the tests.')
  })
})

describe('AI-derived content delete (LUM-917)', () => {
  it('repository batches delete memories with their embedding and side rows', async () => {
    const ids = [
      await seedMemory(WS, 'Batch one.'),
      await seedMemory(WS, 'Batch two.'),
      await seedMemory(WS, 'Batch three.'),
    ]
    await memoryRepository.setEmbedding(ids[0]!, new Array(1024).fill(0.01))
    await db().memoryStaleAnchorReport.create({
      data: {
        memoryId: ids[0]!,
        projectId: `${WS}_project`,
        workspaceId: WS,
        deadAnchors: [{ kind: 'file', value: 'lib/a.ts' }],
      },
    })
    await db().memoryProvenance.create({
      data: { childMemoryId: ids[1]!, parentMemoryId: ids[2]! },
    })

    const before = await db().memory.count({ where: { workspaceId: WS } })
    expect(await aiDerivedContentRepository.deleteMemoryBatch(WS, 2)).toBe(2)
    expect(await db().memory.count({ where: { workspaceId: WS } })).toBe(
      before - 2
    )
    // Drain the rest a batch at a time.
    while ((await aiDerivedContentRepository.deleteMemoryBatch(WS, 2)) > 0) {
      // keep going
    }
    expect(await db().memory.count({ where: { workspaceId: WS } })).toBe(0)
    expect(
      await db().memoryStaleAnchorReport.count({
        where: { memoryId: { in: ids } },
      })
    ).toBe(0)
    expect(
      await db().memoryProvenance.count({
        where: {
          OR: [{ childMemoryId: { in: ids } }, { parentMemoryId: { in: ids } }],
        },
      })
    ).toBe(0)
  })

  it('service purge clears this workspace only, keeps session records, and is idempotent', async () => {
    await seedMemory(WS, 'To delete.')
    await seedMemory(OTHER, 'Belongs to another workspace.')
    await seedSession(WS, 's_purge_1')
    await seedSession(WS, 's_purge_2')
    await seedSession(OTHER, 's_other')
    await seedClaimTask(WS, 't_claim_agent', 'AGENT')
    await seedClaimTask(WS, 't_claim_run', 'RUN_SUMMARY')
    await seedClaimTask(WS, 't_claim_digest', 'DIGEST')
    await seedClaimTask(OTHER, 't_claim_other', 'RUN_SUMMARY')
    await seedVerdict('t_claim_run')
    await seedVerdict('t_claim_other')
    // A hand-added memory (createdByMemberId set) goes with the rest.
    const { id: manualId } = await memoryRepository.create({
      workspaceId: WS,
      projectId: `${WS}_project`,
      taskId: null,
      scope: 'PROJECT',
      category: 'TRAP',
      content: { trigger: 'hand-written', outcome: 'kept until deleted' },
      sourceSessionId: null,
      createdByMemberId: `${WS}_member`,
    })

    const counts = await aiDerivedContentRepository.countForWorkspace(WS)
    expect(counts.memories).toBeGreaterThan(0)
    expect(counts.sessionSummaries).toBeGreaterThanOrEqual(2)
    expect(counts.runSummaries).toBeGreaterThanOrEqual(2)
    expect(counts.claimSnapshots).toBe(2)
    expect(counts.verdictTexts).toBe(1)

    await expect(
      aiDerivedContentService.purge(
        { id: WS, name: `${WS} name` },
        'MEMBER',
        `${WS} name`
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      aiDerivedContentService.purge(
        { id: WS, name: `${WS} name` },
        'OWNER',
        'wrong name'
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(await db().memory.count({ where: { workspaceId: WS } })).toBe(
      counts.memories
    )

    const result = await aiDerivedContentService.purge(
      { id: WS, name: `${WS} name` },
      'OWNER',
      `${WS} name`
    )
    expect(result).toEqual({ deleted: counts, done: true })
    expect(await aiDerivedContentRepository.countForWorkspace(WS)).toEqual({
      memories: 0,
      sessionSummaries: 0,
      runSummaries: 0,
      claimSnapshots: 0,
      verdictTexts: 0,
    })
    expect(await db().memory.findUnique({ where: { id: manualId } })).toBeNull()

    // AI-generated claim snapshots: text, source and session pointer cleared;
    // the synthesized watermark and the task's updatedAt stay.
    for (const id of ['t_claim_run', 't_claim_digest']) {
      const task = await db().task.findUniqueOrThrow({ where: { id } })
      expect(task.claimSnapshot).toBeNull()
      expect(task.claimSnapshotSource).toBeNull()
      expect(task.claimSnapshotSessionId).toBeNull()
      expect(task.claimSnapshotAt).toEqual(SNAPSHOT_AT)
      expect(task.updatedAt).toEqual(TASK_UPDATED_AT)
    }
    // The agent's own report is kept.
    const agentTask = await db().task.findUniqueOrThrow({
      where: { id: 't_claim_agent' },
    })
    expect(agentTask.claimSnapshot).toBe('AGENT claim text')
    expect(agentTask.claimSnapshotSource).toBe('AGENT')
    // Verdict: explanation cleared, the verdict row and label stay.
    const verdict = await db().claimFaithfulnessVerdict.findUniqueOrThrow({
      where: { taskId: 't_claim_run' },
    })
    expect(verdict.evidence).toBeNull()
    expect(verdict.reasoning).toBeNull()
    expect(verdict.verdict).toBe('UNDERREPORT')

    const session = await db().session.findUniqueOrThrow({
      where: { id: 's_purge_1' },
    })
    expect(session.summary).toBeNull()
    expect(session.summaryType).toBeNull()
    expect(session.summaryGeneratedAt).toBeNull()
    expect(session.summaryEventCount).toBeNull()
    expect(session.runSummary).toBeNull()
    expect(session.runSummaryGeneratedAt).toBeNull()
    // The session record itself is not AI-derived content.
    expect(
      await db().hookEvent.count({ where: { sessionId: 's_purge_1' } })
    ).toBe(1)

    // The other workspace is untouched.
    expect(await aiDerivedContentRepository.countForWorkspace(OTHER)).toEqual({
      memories: 1,
      sessionSummaries: 1,
      runSummaries: 1,
      claimSnapshots: 1,
      verdictTexts: 1,
    })

    // Idempotent: a second pass finds nothing.
    expect(
      await aiDerivedContentService.purge(
        { id: WS, name: `${WS} name` },
        'OWNER',
        `${WS} name`
      )
    ).toEqual({
      deleted: {
        memories: 0,
        sessionSummaries: 0,
        runSummaries: 0,
        claimSnapshots: 0,
        verdictTexts: 0,
      },
      done: true,
    })
  })

  it('reads the switch through workspace, project, task and milestone', async () => {
    await db().workspace.update({
      where: { id: OTHER },
      data: { aiDerivedContentEnabled: false },
    })
    await db().task.create({
      data: {
        id: 't_switch',
        projectId: `${OTHER}_project`,
        workspaceId: OTHER,
        teamId: `${OTHER}_team`,
        number: 1,
        title: 't_switch',
      },
    })
    await db().milestone.create({
      data: {
        id: 'm_switch',
        projectId: `${OTHER}_project`,
        name: 'm',
        slug: 'm',
      },
    })
    expect(await aiDerivedContentService.isEnabled({ workspaceId: WS })).toBe(
      true
    )
    expect(
      await aiDerivedContentService.isEnabled({ workspaceId: OTHER })
    ).toBe(false)
    expect(
      await aiDerivedContentService.isEnabled({
        projectId: `${OTHER}_project`,
      })
    ).toBe(false)
    expect(
      await aiDerivedContentService.isEnabled({ taskId: 't_switch' })
    ).toBe(false)
    expect(
      await aiDerivedContentService.isEnabled({ milestoneId: 'm_switch' })
    ).toBe(false)
    // An unknown id fails closed.
    expect(
      await aiDerivedContentService.isEnabled({ projectId: 'missing' })
    ).toBe(false)
  })
})
