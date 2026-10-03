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

import { aiDerivedContentRepository } from '@/lib/repositories/ai-derived-content.repository'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { CODE_OMITTED_MARKER } from '@/lib/ai-derived/strip-code'

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

    const counts = await aiDerivedContentRepository.countForWorkspace(WS)
    expect(counts.memories).toBeGreaterThan(0)
    expect(counts.sessionSummaries).toBeGreaterThanOrEqual(2)
    expect(counts.runSummaries).toBeGreaterThanOrEqual(2)

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
    })

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
    })

    // Idempotent: a second pass finds nothing.
    expect(
      await aiDerivedContentService.purge(
        { id: WS, name: `${WS} name` },
        'OWNER',
        `${WS} name`
      )
    ).toEqual({
      deleted: { memories: 0, sessionSummaries: 0, runSummaries: 0 },
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
