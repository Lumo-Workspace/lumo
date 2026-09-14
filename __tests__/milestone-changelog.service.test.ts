import { milestoneChangelogService } from '@/lib/services/milestone-changelog.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: jest.fn(),
    listCompletedIdsInProject: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    listByMilestoneForChangelog: jest.fn(),
    countDoneByMilestones: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listMergedByTaskIds: jest.fn(),
    countMergedByMilestones: jest.fn(),
  },
}))

const mockMilestoneRepo = milestoneRepository as jest.Mocked<
  typeof milestoneRepository
>
const mockTaskRepo = taskRepository as jest.Mocked<typeof taskRepository>
const mockPrRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>

function taskRow(over: Record<string, unknown>) {
  return {
    id: 'x',
    status: 'DONE',
    number: 1,
    title: 'T',
    team: { identifier: 'LUM' },
    claimSnapshot: null,
    claimSnapshotSource: null,
    claimSnapshotSessionId: null,
    claimSnapshotAt: null,
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...over,
  }
}

describe('milestoneChangelogService.assemble', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // No prior completed milestones by default → honest no-baseline path.
    mockMilestoneRepo.listCompletedIdsInProject.mockResolvedValue([])
    mockTaskRepo.countDoneByMilestones.mockResolvedValue([])
    mockPrRepo.countMergedByMilestones.mockResolvedValue([])
    mockPrRepo.listMergedByTaskIds.mockResolvedValue([])
  })

  test('service includes only DONE tasks and runs on any milestone status', async () => {
    // The milestone is ACTIVE — there is NO COMPLETED gate (unlike the retro).
    mockMilestoneRepo.findById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      name: 'Active Milestone',
      status: 'ACTIVE',
      startDate: null,
      targetDate: null,
    } as never)

    mockTaskRepo.listByMilestoneForChangelog.mockResolvedValue([
      taskRow({ id: 't-done', status: 'DONE', number: 5, title: 'Shipped' }),
      taskRow({ id: 't-prog', status: 'IN_PROGRESS', number: 6, title: 'WIP' }),
      taskRow({ id: 't-todo', status: 'TODO', number: 7, title: 'Later' }),
      taskRow({ id: 't-rev', status: 'IN_REVIEW', number: 8, title: 'Review' }),
    ] as never)

    const result = await milestoneChangelogService.assemble('m1')

    // Runs on an in-flight milestone (there is no completion gate here).
    expect(result.milestone.state).toBe('active')
    // Only the DONE task becomes an entry; the other three statuses are excluded.
    expect(result.entries.map(e => e.identifier)).toEqual(['LUM-5'])
    expect(result.headline.tasksShipped.current).toBe(1)
  })

  test('assemble throws 404 when the milestone does not exist', async () => {
    mockMilestoneRepo.findById.mockResolvedValue(null as never)
    await expect(
      milestoneChangelogService.assemble('missing')
    ).rejects.toThrow()
  })
})
