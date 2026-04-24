import { dispatchSprintNotification } from '@/lib/services/sprint-notifications.service'

const mockFindTeamActorIds = jest.fn()
const mockCreateMany = jest.fn()

jest.mock('@/lib/repositories/sprint-notifications.repository', () => ({
  sprintNotificationsRepository: {
    findTeamActorIds: (...a: any[]) => mockFindTeamActorIds(...a),
  },
}))

jest.mock('@/lib/repositories/notification.repository', () => ({
  notificationRepository: {
    createMany: (...a: any[]) => mockCreateMany(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('dispatchSprintNotification', () => {
  it('creates a SPRINT_STARTED notification per recipient', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce(['a1', 'a2'])
    mockCreateMany.mockResolvedValueOnce({ count: 2 })

    await dispatchSprintNotification(
      'sprint-1',
      'team-1',
      'ws-1',
      'SPRINT_STARTED',
      'actor-x'
    )

    expect(mockFindTeamActorIds).toHaveBeenCalledWith('team-1')
    expect(mockCreateMany).toHaveBeenCalledWith([
      {
        workspaceId: 'ws-1',
        recipientActorId: 'a1',
        type: 'SPRINT_STARTED',
        sprintId: 'sprint-1',
        triggerActorId: 'actor-x',
      },
      {
        workspaceId: 'ws-1',
        recipientActorId: 'a2',
        type: 'SPRINT_STARTED',
        sprintId: 'sprint-1',
        triggerActorId: 'actor-x',
      },
    ])
  })

  it('creates a SPRINT_CLOSED notification per recipient', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce(['a1'])
    mockCreateMany.mockResolvedValueOnce({ count: 1 })

    await dispatchSprintNotification(
      'sprint-1',
      'team-1',
      'ws-1',
      'SPRINT_CLOSED',
      null
    )

    expect(mockCreateMany).toHaveBeenCalledWith([
      {
        workspaceId: 'ws-1',
        recipientActorId: 'a1',
        type: 'SPRINT_CLOSED',
        sprintId: 'sprint-1',
        triggerActorId: null,
      },
    ])
  })

  it('is a no-op when the team has no actors', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce([])

    await dispatchSprintNotification(
      'sprint-1',
      'team-1',
      'ws-1',
      'SPRINT_STARTED',
      'actor-x'
    )

    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('handles triggerActorId=null without throwing', async () => {
    mockFindTeamActorIds.mockResolvedValueOnce(['a1'])
    mockCreateMany.mockResolvedValueOnce({ count: 1 })

    await expect(
      dispatchSprintNotification(
        'sprint-1',
        'team-1',
        'ws-1',
        'SPRINT_STARTED',
        null
      )
    ).resolves.toBeUndefined()
  })
})
