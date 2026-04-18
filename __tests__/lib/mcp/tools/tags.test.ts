import { makeTagHandlers } from '@/lib/mcp/tools/tags'

const mockListTags = jest.fn()

jest.mock('@/lib/services/tag.service', () => ({
  tagService: {
    listTags: (...a: any[]) => mockListTags(...a),
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

describe('list_tags', () => {
  it('delegates to tagService.listTags with workspaceId', async () => {
    const fakeTags = [
      { id: 't-1', name: 'bug', color: '#ff0000', workspaceId: 'ws-1' },
      { id: 't-2', name: 'feature', color: null, workspaceId: 'ws-1' },
    ]
    mockListTags.mockResolvedValue(fakeTags)
    const h = makeTagHandlers(async () => boundCtx)
    const out = await h.list_tags()
    expect(mockListTags).toHaveBeenCalledWith('ws-1')
    expect(out.tags).toEqual(fakeTags)
  })

  it('throws WORKSPACE_REQUIRED when context has no workspaceId', async () => {
    const bootstrapCtx = { clerkUserId: 'u1', connectionId: 'c1' }
    const h = makeTagHandlers(async () => bootstrapCtx as any)
    await expect(h.list_tags()).rejects.toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    })
  })
})
