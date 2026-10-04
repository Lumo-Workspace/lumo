jest.mock('@/lib/repositories/task-dependency.repository', () => ({
  taskDependencyRepository: {
    createManySuggested: jest.fn(),
    findPairsAmong: jest.fn(),
    findTaskIdsInWorkspace: jest.fn(),
    findOpenTasksMeta: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { groupTaskFilesTouched: jest.fn() },
}))
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import {
  dependencyDetectionService,
  SHARED_FILE_MIN,
} from '@/lib/services/dependency-detection.service'

const depRepo = taskDependencyRepository as jest.Mocked<
  typeof taskDependencyRepository
>
const hookRepo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
beforeEach(() => {
  jest.clearAllMocks()
  depRepo.findPairsAmong.mockResolvedValue([])
  depRepo.createManySuggested.mockResolvedValue({ count: 0 })
})

const mention = (id: string) =>
  `<a class="mention mention-task" data-mention-type="task" data-id="${id}">LUM-9</a>`

describe('detectMentionEdges', () => {
  it('persists SUGGESTED edges for workspace-valid mentioned tasks', async () => {
    depRepo.findTaskIdsInWorkspace.mockResolvedValueOnce(['ct2'])
    await dependencyDetectionService.detectMentionEdges({
      taskId: 'ct1',
      workspaceId: 'w1',
      html: `<p>${mention('ct2')}${mention('ghost')}</p>`,
      surface: 'description',
    })
    expect(depRepo.findTaskIdsInWorkspace).toHaveBeenCalledWith(
      ['ct2', 'ghost'],
      'w1'
    )
    expect(depRepo.createManySuggested).toHaveBeenCalledWith([
      expect.objectContaining({
        blockedTaskId: 'ct1',
        blockingTaskId: 'ct2',
        reason: 'task_mention',
        detail: { surface: 'description' },
      }),
    ])
  })
  it('skips pairs that already have an edge in either direction', async () => {
    depRepo.findTaskIdsInWorkspace.mockResolvedValueOnce(['ct2'])
    depRepo.findPairsAmong.mockResolvedValueOnce([
      { blockedTaskId: 'ct2', blockingTaskId: 'ct1' },
    ])
    await dependencyDetectionService.detectMentionEdges({
      taskId: 'ct1',
      workspaceId: 'w1',
      html: mention('ct2'),
      surface: 'comment',
    })
    expect(depRepo.createManySuggested).toHaveBeenCalledWith([])
  })
  it('no-ops on html without task mentions', async () => {
    await dependencyDetectionService.detectMentionEdges({
      taskId: 'ct1',
      workspaceId: 'w1',
      html: '<p>plain</p>',
      surface: 'comment',
    })
    expect(depRepo.createManySuggested).not.toHaveBeenCalled()
  })
})

describe('sweepSharedFileCandidates', () => {
  const day = 24 * 60 * 60 * 1000
  const now = new Date('2026-06-09T00:00:00Z')
  const rows = (taskId: string, files: string[], workspaceId = 'w1') =>
    files.map(filePath => ({ workspaceId, taskId, filePath }))

  it('suggests edge when shared files >= threshold, older task blocks newer', async () => {
    const files = ['a.ts', 'b.ts', 'c.ts']
    hookRepo.groupTaskFilesTouched.mockResolvedValueOnce([
      ...rows('t-old', [...files, 'extra.ts']),
      ...rows('t-new', files),
    ] as never)
    depRepo.findOpenTasksMeta.mockResolvedValueOnce([
      {
        id: 't-old',
        createdAt: new Date(now.getTime() - 2 * day),
      },
      {
        id: 't-new',
        createdAt: new Date(now.getTime() - day),
      },
    ])
    await dependencyDetectionService.sweepSharedFileCandidates(now)
    expect(depRepo.createManySuggested).toHaveBeenCalledWith([
      expect.objectContaining({
        blockedTaskId: 't-new',
        blockingTaskId: 't-old',
        reason: 'shared_files',
        detail: { count: 3, sample: files },
      }),
    ])
    expect(SHARED_FILE_MIN).toBe(3)
  })
  it('ignores pairs below threshold and cross-workspace pairs', async () => {
    hookRepo.groupTaskFilesTouched.mockResolvedValueOnce([
      ...rows('p', ['a.ts', 'b.ts', 'c.ts']),
      ...rows('w2task', ['a.ts', 'b.ts', 'c.ts'], 'w2'),
      ...rows('small1', ['x.ts']),
      ...rows('small2', ['x.ts']),
    ] as never)
    depRepo.findOpenTasksMeta.mockResolvedValueOnce([
      { id: 'p', createdAt: new Date(0) },
      { id: 'w2task', createdAt: new Date(2) },
      { id: 'small1', createdAt: new Date(3) },
      { id: 'small2', createdAt: new Date(4) },
    ])
    await dependencyDetectionService.sweepSharedFileCandidates(now)
    expect(depRepo.createManySuggested).toHaveBeenCalledWith([])
  })
  it('excludes DONE tasks via findOpenTasksMeta result (absent id never paired)', async () => {
    hookRepo.groupTaskFilesTouched.mockResolvedValueOnce([
      ...rows('t1', ['a.ts', 'b.ts', 'c.ts']),
      ...rows('t-done', ['a.ts', 'b.ts', 'c.ts']),
    ] as never)
    depRepo.findOpenTasksMeta.mockResolvedValueOnce([
      { id: 't1', createdAt: new Date(0) },
    ])
    await dependencyDetectionService.sweepSharedFileCandidates(now)
    expect(depRepo.createManySuggested).toHaveBeenCalledWith([])
  })
  it('returns suggested count from repository', async () => {
    const files = ['a.ts', 'b.ts', 'c.ts']
    hookRepo.groupTaskFilesTouched.mockResolvedValueOnce([
      ...rows('t1', files),
      ...rows('t2', files),
    ] as never)
    depRepo.findOpenTasksMeta.mockResolvedValueOnce([
      { id: 't1', createdAt: new Date(0) },
      { id: 't2', createdAt: new Date(1) },
    ])
    depRepo.createManySuggested.mockResolvedValueOnce({ count: 1 })
    await expect(
      dependencyDetectionService.sweepSharedFileCandidates(now)
    ).resolves.toEqual({ suggested: 1 })
  })
})
