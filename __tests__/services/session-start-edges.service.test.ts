/** @jest-environment node */
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildSessionStartSections: jest.fn(),
    buildReviewTodosSectionForTask: jest.fn(),
    buildLayer2ReviewSectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
  },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: {
    recordSessionStartEdges: jest.fn().mockResolvedValue(undefined),
    recordDroppedFragments: jest.fn().mockResolvedValue(undefined),
  },
}))

import { sessionStartEdgesService } from '@/lib/services/session-start-edges.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'

const MEMORY_FRAGMENT = {
  fragmentType: 'MEMORY' as const,
  fragmentId: 'mem-1',
  disclosure: 'INDEX' as const,
  indexTokens: 12,
  fullTokens: 240,
  relevanceScore: 0.83,
}

function setBuilders(
  overrides: {
    sectionFragments?: unknown[]
    droppedFragments?: unknown[]
    todoFragments?: unknown[]
    layer2Fragments?: unknown[]
    previous?: unknown
  } = {}
) {
  ;(
    taskContextService.buildSessionStartSections as jest.Mock
  ).mockResolvedValue({
    memorySection: '',
    linkedResourcesSection: '',
    budget: { budgetTokens: 2500, sections: {} },
    fragments: overrides.sectionFragments ?? [
      MEMORY_FRAGMENT,
      { fragmentType: 'SLACK_CONTEXT', fragmentId: 's1', disclosure: 'INDEX' },
      { fragmentType: 'WEB_LINK', fragmentId: 'w1', disclosure: 'INDEX' },
      { fragmentType: 'FIGMA', fragmentId: 'f1', disclosure: 'INDEX' },
      { fragmentType: 'PR', fragmentId: 'pr1', disclosure: 'INDEX' },
    ],
    droppedFragments: overrides.droppedFragments ?? [],
  })
  ;(
    taskContextService.buildReviewTodosSectionForTask as jest.Mock
  ).mockResolvedValue({
    section: '',
    fragments: overrides.todoFragments ?? [
      { fragmentType: 'PR_REVIEW_TODO', fragmentId: 'todo-1' },
    ],
  })
  ;(
    taskContextService.buildLayer2ReviewSectionForTask as jest.Mock
  ).mockResolvedValue({
    section: '',
    fragments: overrides.layer2Fragments ?? [
      { fragmentType: 'MEMORY', fragmentId: 'mem-proj' },
    ],
    dropped: 0,
  })
  ;(
    taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
  ).mockResolvedValue(
    overrides.previous === undefined
      ? { sessionId: 'prev-s', headline: 'h', unresolved: [], durationMs: 0 }
      : overrides.previous
  )
}

const SCOPE = { workspaceId: 'ws_1', taskId: 'task-1', sessionId: 's-1' }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('sessionStartEdgesService.collectAndRecord', () => {
  it('attach records session-start edges with full hook fragment parity', async () => {
    setBuilders()

    await sessionStartEdgesService.collectAndRecord(SCOPE)

    expect(lineageService.recordSessionStartEdges).toHaveBeenCalledTimes(1)
    const call = (lineageService.recordSessionStartEdges as jest.Mock).mock
      .calls[0][0]
    expect(call.workspaceId).toBe('ws_1')
    expect(call.taskId).toBe('task-1')
    expect(call.sessionId).toBe('s-1')
    expect(
      call.fragments.map((f: { fragmentType: string }) => f.fragmentType)
    ).toEqual([
      'MEMORY',
      'SLACK_CONTEXT',
      'WEB_LINK',
      'FIGMA',
      'PR',
      'PR_REVIEW_TODO',
      'MEMORY',
      'SESSION',
    ])
    expect(call.fragments[call.fragments.length - 1]).toEqual({
      fragmentType: 'SESSION',
      fragmentId: 'prev-s',
    })
  })

  it('attach edges carry INDEX disclosure and token weights and relevanceScore', async () => {
    setBuilders()

    await sessionStartEdgesService.collectAndRecord(SCOPE)

    const call = (lineageService.recordSessionStartEdges as jest.Mock).mock
      .calls[0][0]
    expect(call.fragments[0]).toEqual(MEMORY_FRAGMENT)
  })

  it('attach records dropped fragments from the relevance gate', async () => {
    const dropped = [
      { fragmentType: 'MEMORY', fragmentId: 'mem-drop', relevanceScore: 0.1 },
    ]
    setBuilders({ droppedFragments: dropped })

    await sessionStartEdgesService.collectAndRecord(SCOPE)

    expect(lineageService.recordDroppedFragments).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      taskId: 'task-1',
      sessionId: 's-1',
      dropped,
    })
  })

  it('omits the SESSION edge when there is no previous session', async () => {
    setBuilders({ previous: null })

    await sessionStartEdgesService.collectAndRecord(SCOPE)

    const call = (lineageService.recordSessionStartEdges as jest.Mock).mock
      .calls[0][0]
    expect(
      call.fragments.some(
        (f: { fragmentType: string }) => f.fragmentType === 'SESSION'
      )
    ).toBe(false)
  })

  it('does not record edges or drops when everything is empty', async () => {
    setBuilders({
      sectionFragments: [],
      todoFragments: [],
      layer2Fragments: [],
      previous: null,
      droppedFragments: [],
    })

    await sessionStartEdgesService.collectAndRecord(SCOPE)

    expect(lineageService.recordSessionStartEdges).not.toHaveBeenCalled()
    expect(lineageService.recordDroppedFragments).not.toHaveBeenCalled()
  })

  it('never throws when a builder rejects (best-effort)', async () => {
    setBuilders()
    ;(
      taskContextService.buildSessionStartSections as jest.Mock
    ).mockRejectedValue(new Error('boom'))

    await expect(
      sessionStartEdgesService.collectAndRecord(SCOPE)
    ).resolves.toBeUndefined()
    expect(lineageService.recordSessionStartEdges).not.toHaveBeenCalled()
  })
})
