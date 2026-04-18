import { makeNotificationHandlers } from '@/lib/mcp/tools/notifications'

const mockFindActorByMemberId = jest.fn()
const mockGetNotifications = jest.fn()
const mockGetNotification = jest.fn()

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: (...a: any[]) => mockFindActorByMemberId(...a),
  },
}))

jest.mock('@/lib/services/notification.service', () => ({
  notificationService: {
    getNotifications: (...a: any[]) => mockGetNotifications(...a),
    getNotification: (...a: any[]) => mockGetNotification(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

const boundCtx = {
  clerkUserId: 'u1',
  connectionId: 'c1',
  workspaceId: 'ws-1',
  memberId: 'm-1',
  memberRole: 'MEMBER' as const,
}

describe('list_notifications', () => {
  it('resolves actor and delegates to notificationService.getNotifications', async () => {
    mockFindActorByMemberId.mockResolvedValue({ id: 'a-1' })
    mockGetNotifications.mockResolvedValue([
      { id: 'n-1', type: 'TASK_ASSIGNED', read: false, createdAt: new Date() },
    ])
    const h = makeNotificationHandlers(async () => boundCtx)
    const out = await h.list_notifications()
    expect(mockFindActorByMemberId).toHaveBeenCalledWith('m-1')
    expect(mockGetNotifications).toHaveBeenCalledWith('a-1', 'ws-1')
    expect(out.notifications).toHaveLength(1)
    expect(out.notifications[0]?.id).toBe('n-1')
  })

  it('throws WORKSPACE_REQUIRED when context has no workspaceId', async () => {
    const bootstrapCtx = { clerkUserId: 'u1', connectionId: 'c1' }
    const h = makeNotificationHandlers(async () => bootstrapCtx as any)
    await expect(h.list_notifications()).rejects.toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    })
  })
})

describe('get_notification', () => {
  it('resolves actor and delegates to notificationService.getNotification', async () => {
    mockFindActorByMemberId.mockResolvedValue({ id: 'a-1' })
    mockGetNotification.mockResolvedValue({
      id: 'n-1',
      type: 'TASK_ASSIGNED',
      read: false,
      createdAt: new Date(),
    })
    const h = makeNotificationHandlers(async () => boundCtx)
    const out = await h.get_notification({ notificationId: 'n-1' })
    expect(mockGetNotification).toHaveBeenCalledWith('n-1', 'a-1')
    expect(out.notification.id).toBe('n-1')
  })

  it('propagates 404 for missing or cross-user notification', async () => {
    mockFindActorByMemberId.mockResolvedValue({ id: 'a-1' })
    mockGetNotification.mockRejectedValue(
      Object.assign(new Error('Notification not found'), { status: 404 })
    )
    const h = makeNotificationHandlers(async () => boundCtx)
    await expect(
      h.get_notification({ notificationId: 'n-other' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
