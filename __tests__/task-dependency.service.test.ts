jest.mock('@/lib/repositories/task-dependency.repository', () => ({
  taskDependencyRepository: {
    findEdgesForTask: jest.fn(),
    findById: jest.fn(),
    findByPair: jest.fn(),
    findConfirmedBlocksEdges: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findLiveBlockersForTask: jest.fn(),
    countSuggestedForTask: jest.fn(),
    findSuggestedDuplicatesForTask: jest.fn(),
  },
}))

import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { taskDependencyService } from '@/lib/services/task-dependency.service'

const repo = taskDependencyRepository as jest.Mocked<
  typeof taskDependencyRepository
>
beforeEach(() => {
  jest.clearAllMocks()
  ;(
    taskDependencyRepository.findSuggestedDuplicatesForTask as jest.Mock
  ).mockResolvedValue([])
})

/** Helper: build a full edge object with sensible defaults, override via `over`. */
const edge = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  workspaceId: 'w1',
  blockedTaskId: 'a',
  blockingTaskId: 'b',
  kind: 'BLOCKS',
  source: 'DETECTED',
  status: 'SUGGESTED',
  reason: 'task_mention',
  detail: null,
  confirmedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  blockedTask: {
    id: 'a',
    number: 1,
    title: 'A',
    status: 'TODO',
    team: { identifier: 'LUM' },
  },
  blockingTask: {
    id: 'b',
    number: 2,
    title: 'B',
    status: 'TODO',
    team: { identifier: 'LUM' },
  },
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
// listForTask
// ─────────────────────────────────────────────────────────────────────────────
describe('taskDependencyService.listForTask', () => {
  it('returns view rows with BLOCKED_BY direction when taskId is the blocked side', async () => {
    repo.findEdgesForTask.mockResolvedValueOnce([edge() as any])
    const views = await taskDependencyService.listForTask('a')
    expect(views).toHaveLength(1)
    const [v] = views
    expect(v!.direction).toBe('BLOCKED_BY')
    expect(v!.other.identifier).toBe('LUM-2') // blockingTask = b, number=2
  })

  it('returns BLOCKS direction when taskId is the blocking side', async () => {
    repo.findEdgesForTask.mockResolvedValueOnce([edge() as any])
    const views = await taskDependencyService.listForTask('b')
    const [v] = views
    expect(v!.direction).toBe('BLOCKS')
    expect(v!.other.identifier).toBe('LUM-1') // blockedTask = a, number=1
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// addManual
// ─────────────────────────────────────────────────────────────────────────────
describe('taskDependencyService.addManual', () => {
  it('① self-edge → rejects 400', async () => {
    await expect(
      taskDependencyService.addManual({
        workspaceId: 'w1',
        blockedTaskId: 'a',
        blockingTaskId: 'a',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('② cycle via existing confirmed edge (a←b exists; adding b←a) → rejects 409', async () => {
    // existing: a blocked by b (a depends on b)
    repo.findByPair.mockResolvedValueOnce(null)
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([
      { blockedTaskId: 'a', blockingTaskId: 'b' },
    ])
    // adding b←a (b blocked by a) — meaning b would depend on a, but a already depends on b: cycle
    await expect(
      taskDependencyService.addManual({
        workspaceId: 'w1',
        blockedTaskId: 'b',
        blockingTaskId: 'a',
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('③ transitive cycle (a←b, b←c; adding c←a) → rejects 409', async () => {
    repo.findByPair.mockResolvedValueOnce(null)
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([
      { blockedTaskId: 'a', blockingTaskId: 'b' },
      { blockedTaskId: 'b', blockingTaskId: 'c' },
    ])
    // adding c←a: c depends on a, but a→b→c — cycle
    await expect(
      taskDependencyService.addManual({
        workspaceId: 'w1',
        blockedTaskId: 'c',
        blockingTaskId: 'a',
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('④ no cycle → repo.create called with MANUAL/CONFIRMED/BLOCKS', async () => {
    repo.findByPair.mockResolvedValueOnce(null)
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([])
    repo.create.mockResolvedValueOnce(
      edge({ source: 'MANUAL', status: 'CONFIRMED' }) as any
    )
    await taskDependencyService.addManual({
      workspaceId: 'w1',
      blockedTaskId: 'a',
      blockingTaskId: 'b',
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MANUAL',
        status: 'CONFIRMED',
        kind: 'BLOCKS',
      })
    )
  })

  it('⑤ existing SUGGESTED same-pair → repo.update instead of create', async () => {
    repo.findByPair.mockResolvedValueOnce({
      id: 'e1',
      status: 'SUGGESTED',
    } as any)
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([])
    repo.update.mockResolvedValueOnce(edge({ status: 'CONFIRMED' }) as any)
    await taskDependencyService.addManual({
      workspaceId: 'w1',
      blockedTaskId: 'a',
      blockingTaskId: 'b',
    })
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.update).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({
        status: 'CONFIRMED',
        confirmedAt: expect.any(Date),
      })
    )
  })

  it('⑥ existing CONFIRMED same-pair → rejects 409', async () => {
    repo.findByPair.mockResolvedValueOnce({
      id: 'e1',
      status: 'CONFIRMED',
    } as any)
    await expect(
      taskDependencyService.addManual({
        workspaceId: 'w1',
        blockedTaskId: 'a',
        blockingTaskId: 'b',
      })
    ).rejects.toMatchObject({ status: 409 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// confirm
// ─────────────────────────────────────────────────────────────────────────────
describe('taskDependencyService.confirm', () => {
  it('① unknown edge → 404', async () => {
    repo.findById.mockResolvedValueOnce(null)
    await expect(
      taskDependencyService.confirm({ edgeId: 'e999' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('② happy path → cycle check then repo.update with CONFIRMED + confirmedAt', async () => {
    repo.findById.mockResolvedValueOnce(edge() as any)
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([])
    repo.update.mockResolvedValueOnce(edge({ status: 'CONFIRMED' }) as any)
    await taskDependencyService.confirm({ edgeId: 'e1' })
    expect(repo.findConfirmedBlocksEdges).toHaveBeenCalled()
    expect(repo.update).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({
        status: 'CONFIRMED',
        confirmedAt: expect.any(Date),
      })
    )
  })

  it('③ reverse=true with existing reverse-pair edge → 409', async () => {
    repo.findById.mockResolvedValueOnce(edge() as any) // a←b
    // reverse would be b←a; findByPair returns existing
    repo.findByPair.mockResolvedValueOnce({
      id: 'e2',
      status: 'CONFIRMED',
    } as any)
    await expect(
      taskDependencyService.confirm({ edgeId: 'e1', reverse: true })
    ).rejects.toMatchObject({
      status: 409,
    })
  })

  it('④ reverse=true happy path → repo.update with swapped ids', async () => {
    repo.findById.mockResolvedValueOnce(edge() as any) // a←b
    repo.findByPair.mockResolvedValueOnce(null)
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([])
    repo.update.mockResolvedValueOnce(
      edge({
        blockedTaskId: 'b',
        blockingTaskId: 'a',
        status: 'CONFIRMED',
      }) as any
    )
    await taskDependencyService.confirm({ edgeId: 'e1', reverse: true })
    expect(repo.update).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({
        blockedTaskId: 'b',
        blockingTaskId: 'a',
        status: 'CONFIRMED',
      })
    )
  })

  it('⑤ reverse=true + repo.update throws P2002 → 409 (concurrent reverse edge)', async () => {
    repo.findById.mockResolvedValueOnce(edge() as any) // a←b
    repo.findByPair.mockResolvedValueOnce(null) // no existing reverse at check time
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([])
    // Simulate concurrent creation: update hits the pair unique constraint
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    })
    repo.update.mockRejectedValueOnce(p2002)
    await expect(
      taskDependencyService.confirm({ edgeId: 'e1', reverse: true })
    ).rejects.toMatchObject({
      status: 409,
    })
  })

  it('⑥ confirm would create cycle → 409', async () => {
    // edge: a blocked by b; already have b depends on a (b←a exists) — but wait, let's do direct cycle
    // edge a←b; confirmed edges already have b←a ⇒ adding a←b creates cycle
    repo.findById.mockResolvedValueOnce(edge() as any) // a←b
    repo.findConfirmedBlocksEdges.mockResolvedValueOnce([
      { blockedTaskId: 'b', blockingTaskId: 'a' },
    ])
    await expect(
      taskDependencyService.confirm({ edgeId: 'e1' })
    ).rejects.toMatchObject({ status: 409 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// dismiss
// ─────────────────────────────────────────────────────────────────────────────
describe('taskDependencyService.dismiss', () => {
  it('unknown → 404', async () => {
    repo.findById.mockResolvedValueOnce(null)
    await expect(taskDependencyService.dismiss('e999')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('happy → repo.update with DISMISSED + confirmedAt null', async () => {
    repo.findById.mockResolvedValueOnce(edge() as any)
    repo.update.mockResolvedValueOnce(
      edge({ status: 'DISMISSED', confirmedAt: null }) as any
    )
    await taskDependencyService.dismiss('e1')
    expect(repo.update).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ status: 'DISMISSED', confirmedAt: null })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// remove
// ─────────────────────────────────────────────────────────────────────────────
describe('taskDependencyService.remove', () => {
  it('unknown → 404', async () => {
    repo.findById.mockResolvedValueOnce(null)
    await expect(taskDependencyService.remove('e999')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('happy → repo.delete called', async () => {
    repo.findById.mockResolvedValueOnce(edge() as any)
    repo.delete.mockResolvedValueOnce(undefined as any)
    await taskDependencyService.remove('e1')
    expect(repo.delete).toHaveBeenCalledWith('e1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildBlockerWarningSectionForTask
// ─────────────────────────────────────────────────────────────────────────────
describe('taskDependencyService.buildBlockerWarningSectionForTask', () => {
  it('① live blocker with open PR + suggestedCount=2 → contains expected strings', async () => {
    repo.findLiveBlockersForTask.mockResolvedValueOnce([
      {
        blockingTask: {
          id: 'x',
          number: 9,
          title: 'Fix auth',
          status: 'IN_PROGRESS',
          team: { identifier: 'LUM' },
          pullRequests: [{ number: 12, isDraft: false }],
        },
      },
    ] as any)
    repo.countSuggestedForTask.mockResolvedValueOnce(2)
    const result =
      await taskDependencyService.buildBlockerWarningSectionForTask(
        'task1',
        'LUM-1'
      )
    expect(result).toContain('LUM-9')
    expect(result).toContain('PR #12')
    expect(result).toContain('lumo task deps list LUM-1')
  })

  it('② nothing → empty string', async () => {
    repo.findLiveBlockersForTask.mockResolvedValueOnce([])
    repo.countSuggestedForTask.mockResolvedValueOnce(0)
    const result =
      await taskDependencyService.buildBlockerWarningSectionForTask(
        'task1',
        'LUM-1'
      )
    expect(result).toBe('')
  })

  it('③ repo throws → resolves empty string (never throws)', async () => {
    repo.findLiveBlockersForTask.mockRejectedValueOnce(new Error('DB down'))
    repo.countSuggestedForTask.mockResolvedValueOnce(0)
    const result =
      await taskDependencyService.buildBlockerWarningSectionForTask(
        'task1',
        'LUM-1'
      )
    expect(result).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LUM-1286: possible duplicates from the background check
// ─────────────────────────────────────────────────────────────────────────────
const dupRow = (over: Record<string, unknown> = {}) => ({
  detail: { score: 0.95 },
  blockingTask: {
    number: 2,
    title: '导出冲刺燃尽图为 CSV',
    status: 'TODO',
    team: { identifier: 'LUM' },
  },
  ...over,
})

describe('taskDependencyService.listPossibleDuplicates (LUM-1286)', () => {
  it('maps suggested duplicates to the likely original and its score', async () => {
    ;(
      taskDependencyRepository.findSuggestedDuplicatesForTask as jest.Mock
    ).mockResolvedValueOnce([dupRow(), dupRow({ detail: null })])

    await expect(
      taskDependencyService.listPossibleDuplicates('task1')
    ).resolves.toEqual([
      { identifier: 'LUM-2', title: '导出冲刺燃尽图为 CSV', status: 'TODO', score: 0.95 },
      { identifier: 'LUM-2', title: '导出冲刺燃尽图为 CSV', status: 'TODO', score: null },
    ])
  })
})

describe('buildBlockerWarningSectionForTask — possible duplicates (LUM-1286)', () => {
  it('names each likely original with confirm / dismiss commands, apart from other suggestions', async () => {
    repo.findLiveBlockersForTask.mockResolvedValueOnce([])
    repo.countSuggestedForTask.mockResolvedValueOnce(3)
    ;(
      taskDependencyRepository.findSuggestedDuplicatesForTask as jest.Mock
    ).mockResolvedValueOnce([dupRow()])

    const out = await taskDependencyService.buildBlockerWarningSectionForTask(
      'task1',
      'LUM-50'
    )

    expect(out).toContain('Possible duplicate')
    expect(out).toContain('LUM-2 "导出冲刺燃尽图为 CSV" (95% match)')
    expect(out).toContain('lumo task deps confirm LUM-50 LUM-2')
    expect(out).toContain('lumo task deps dismiss LUM-50 LUM-2')
    expect(out).toMatch(/ask the user/i)
    // 3 suggestions, 1 of them the duplicate → 2 other candidates.
    expect(out).toContain('Detected 2 candidate dependencies')
  })

  it('omits the generic line when the duplicates are the only suggestions', async () => {
    repo.findLiveBlockersForTask.mockResolvedValueOnce([])
    repo.countSuggestedForTask.mockResolvedValueOnce(1)
    ;(
      taskDependencyRepository.findSuggestedDuplicatesForTask as jest.Mock
    ).mockResolvedValueOnce([dupRow()])

    const out = await taskDependencyService.buildBlockerWarningSectionForTask(
      'task1',
      'LUM-50'
    )

    expect(out).toContain('Possible duplicate')
    expect(out).not.toContain('candidate dependencies')
  })
})

it('keeps the blocker warning when the duplicate read fails (LUM-1286)', async () => {
  repo.findLiveBlockersForTask.mockResolvedValueOnce([
    {
      blockingTask: {
        id: 'x',
        number: 9,
        title: 'Fix auth',
        status: 'IN_PROGRESS',
        team: { identifier: 'LUM' },
        pullRequests: [],
      },
    },
  ] as any)
  repo.countSuggestedForTask.mockResolvedValueOnce(0)
  ;(
    taskDependencyRepository.findSuggestedDuplicatesForTask as jest.Mock
  ).mockRejectedValueOnce(new Error('db down'))

  const out = await taskDependencyService.buildBlockerWarningSectionForTask(
    'task1',
    'LUM-1'
  )

  expect(out).toContain('LUM-9')
  expect(out).not.toContain('Possible duplicate')
})
