import { makeCommentHandlers } from '@/lib/mcp/tools/comments'

const mockGetComments = jest.fn()

jest.mock('@/lib/services/comment.service', () => ({
  commentService: {
    getComments: (...a: unknown[]) => mockGetComments(...a),
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

describe('list_task_comments', () => {
  it('delegates to commentService.getComments with taskId', async () => {
    mockGetComments.mockResolvedValue([{ id: 'cm-1', body: 'hi' }])
    const h = makeCommentHandlers(async () => boundCtx)
    const out = await h.list_task_comments({ taskId: 't-1' })
    expect(mockGetComments).toHaveBeenCalledWith('t-1')
    expect(out.comments).toHaveLength(1)
  })

  it('throws WORKSPACE_REQUIRED in bootstrap mode', async () => {
    const bootstrap = { clerkUserId: 'u1', connectionId: 'c1' }

    const h = makeCommentHandlers(async () => bootstrap as any)
    await expect(h.list_task_comments({ taskId: 't-1' })).rejects.toMatchObject(
      { code: 'WORKSPACE_REQUIRED' }
    )
  })
})
