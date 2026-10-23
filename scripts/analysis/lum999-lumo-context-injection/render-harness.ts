/**
 * @jest-environment node
 *
 * LUM-999 — render a synthetic task fixture through the REAL Lumo renderers of
 * whichever tree jest is running in.
 *
 * Only the data layer is replaced: every repository / external service that
 * `taskContextService.getContextForIdentifier` reads returns rows from the
 * fixture. The service's own section assembly, the `lib/context/render/*`
 * renderers, the memory/linked wrappers and the guard all run for real, and
 * the result goes through the real CLI `formatTaskContextMarkdown` after a
 * JSON round-trip (the HTTP boundary). Nothing here re-implements rendering.
 *
 * Two entry points:
 *   - `renderVariant()` — imported by this task's jest tests (current tree);
 *   - arm mode — `render-arms.ts` copies this file + fixtures.ts into an arm
 *     worktree and runs jest there with LUM999_VARIANTS / LUM999_OUT set.
 *
 * Every import is `@/…` so it binds to the tree jest's rootDir points at.
 */
import { readFileSync, writeFileSync } from 'fs'
import type { TaskFixture } from './fixtures'

const mockState: { f: TaskFixture | null } = { f: null }
function mockFixture(): TaskFixture {
  if (!mockState.f) throw new Error('render-harness: no fixture loaded')
  return mockState.f
}

jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: jest.fn(async () => {
    throw new Error('offline')
  }),
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(async () => ({
      id: mockFixture().task.id,
      identifier: mockFixture().task.identifier,
    })),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn(async () => mockFixture().task) },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(async () =>
      mockFixture().sessions.map(s => ({
        ...s,
        startedAt: new Date(s.startedAt),
        lastActivityAt: new Date(s.lastActivityAt),
      }))
    ),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findTurnBoundaryEventsForSessions: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(async () => mockFixture().taskMemories),
    findActiveProjectMemories: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn(async () => null) },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: {
    listByTask: jest.fn(async () =>
      mockFixture().slack.map(c => ({
        ...c,
        snapshotAt: new Date(c.snapshotAt),
      }))
    ),
  },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: {
    listByTask: jest.fn(async () =>
      mockFixture().web.map(l => ({ ...l, fetchedAt: new Date(l.fetchedAt) }))
    ),
  },
}))
jest.mock('@/lib/repositories/task-decision.repository', () => ({
  taskDecisionRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: {
    listForTask: jest.fn(async () => []),
    refreshLinksForTask: jest.fn(async () => []),
    refreshLinksForTaskAuto: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/services/test-case-reminder.service', () => ({
  testCaseReminderService: {
    stateForTask: jest.fn(async () => {
      throw new Error('offline')
    }),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findDocumentsForContext: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: {
    listAllForTask: jest.fn(async () =>
      mockFixture().comments.map(c => ({
        ...c,
        createdAt: new Date(c.createdAt),
      }))
    ),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listByTask: jest.fn(async () => mockFixture().prs),
    listIdAndNumberByTask: jest.fn(async () =>
      mockFixture().prs.map(p => ({ id: p.id, number: p.number }))
    ),
  },
}))
jest.mock('@/lib/repositories/pr-comment-mirror.repository', () => ({
  prCommentMirrorRepository: {
    listReviewTodosForPrs: jest.fn(async () => mockFixture().reviewMirrors),
  },
}))
jest.mock('@/lib/repositories/actor.repository', () => ({
  actorRepository: {
    findGithubIdentitiesByIds: jest.fn(
      async () => mockFixture().githubIdentities
    ),
  },
}))
jest.mock('@/ee/security/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {},
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { judgedUsageByFragments: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async () => null),
  },
}))

/** Fixed clock so "X ago" in the sessions list is deterministic. */
export const RENDER_NOW = new Date('2026-10-05T12:00:00.000Z')

export interface RenderedVariant {
  id: string
  markdown: string
}

/**
 * `lumo task context <id>` output for one fixture, produced by this tree's
 * service + CLI renderer.
 */
export async function renderVariant(v: {
  id: string
  fixture: TaskFixture
}): Promise<RenderedVariant> {
  mockState.f = v.fixture
  const { taskContextService } =
    await import('@/lib/services/task-context.service')
  const { formatTaskContextMarkdown } =
    await import('@/cli/src/commands/task-context')
  const ctx = await taskContextService.getContextForIdentifier(
    'ws_demo',
    'member_demo',
    v.fixture.task.identifier
  )
  if (!ctx) throw new Error(`no context for ${v.id}`)
  // The HTTP boundary: the CLI only ever sees the JSON form.
  const wire = JSON.parse(JSON.stringify(ctx)) as Parameters<
    typeof formatTaskContextMarkdown
  >[0]
  return { id: v.id, markdown: formatTaskContextMarkdown(wire, RENDER_NOW) }
}

// Arm mode: driven by render-arms.ts inside another worktree.
const variantsPath = process.env.LUM999_VARIANTS
const outPath = process.env.LUM999_OUT
if (variantsPath && outPath) {
  describe('LUM-999 arm render', () => {
    it('renders every variant through this tree', async () => {
      const variants = JSON.parse(readFileSync(variantsPath, 'utf8')) as Array<{
        id: string
        fixture: TaskFixture
      }>
      const out: RenderedVariant[] = []
      for (const v of variants) out.push(await renderVariant(v))
      writeFileSync(outPath, JSON.stringify(out, null, 2))
      expect(out).toHaveLength(variants.length)
    })
  })
}
