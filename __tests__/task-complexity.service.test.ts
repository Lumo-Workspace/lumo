import { taskComplexityService } from '@/lib/services/task-complexity.service'

const mockListRunSignals = jest.fn()
const mockUpsert = jest.fn()

jest.mock('@/lib/repositories/task-complexity.repository', () => ({
  taskComplexityRepository: {
    listRunSignalsForTask: (...a: any[]) => mockListRunSignals(...a),
    upsert: (...a: any[]) => mockUpsert(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskComplexityService.sedimentForTask', () => {
  it('求和 durationMs,changedFiles 跨 run 去重并集计数', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: 100, changedFiles: ['a.ts', 'b.ts'] },
      { durationMs: 50, changedFiles: ['b.ts', 'c.ts'] },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).toHaveBeenCalledWith({
      taskId: 't1',
      teamId: 'team1',
      totalDurationMs: 150,
      changedFileCount: 3, // {a,b,c}
      agentRunCount: 2,
    })
  })

  it('durationMs 为 null 的 run 计入 run 数但不加时长', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: null, changedFiles: ['a.ts'] },
      { durationMs: 80, changedFiles: ['a.ts'] },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: 80, changedFileCount: 1, agentRunCount: 2 })
    )
  })

  it('changedFiles 非数组(null/非法)被安全跳过', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: 20, changedFiles: null },
      { durationMs: 30, changedFiles: 'oops' },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: 50, changedFileCount: 0, agentRunCount: 2 })
    )
  })

  it('无任何 run → 不 upsert(纯人工任务不沉淀)', async () => {
    mockListRunSignals.mockResolvedValueOnce([])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('有 run 但两信号皆为空 → 不 upsert(无信号不污染分布)', async () => {
    mockListRunSignals.mockResolvedValueOnce([
      { durationMs: null, changedFiles: null },
    ])
    await taskComplexityService.sedimentForTask('t1', 'team1')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('repository 抛错被自捕获,不向上抛(fire-and-forget)', async () => {
    mockListRunSignals.mockRejectedValueOnce(new Error('db down'))
    await expect(
      taskComplexityService.sedimentForTask('t1', 'team1')
    ).resolves.toBeUndefined()
  })
})
