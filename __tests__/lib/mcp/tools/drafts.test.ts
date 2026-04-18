import { makeDraftHandlers } from '@/lib/mcp/tools/drafts'

const mockFindActorByMemberId = jest.fn()
const mockListDrafts = jest.fn()
const mockGetDraft = jest.fn()

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: (...a: any[]) => mockFindActorByMemberId(...a),
  },
}))

jest.mock('@/lib/services/draft.service', () => ({
  draftService: {
    listDrafts: (...a: any[]) => mockListDrafts(...a),
    getDraft: (...a: any[]) => mockGetDraft(...a),
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

describe('list_my_drafts', () => {
  it('resolves actor and delegates to draftService.listDrafts', async () => {
    mockFindActorByMemberId.mockResolvedValue({ id: 'a-1' })
    mockListDrafts.mockResolvedValue([
      {
        id: 'd-1',
        type: 'TASK',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    const h = makeDraftHandlers(async () => boundCtx)
    const out = await h.list_my_drafts()
    expect(mockFindActorByMemberId).toHaveBeenCalledWith('m-1')
    expect(mockListDrafts).toHaveBeenCalledWith('ws-1', 'a-1')
    expect(out.drafts).toHaveLength(1)
    expect(out.drafts[0]?.id).toBe('d-1')
  })

  it('throws WORKSPACE_REQUIRED when context has no workspaceId', async () => {
    const bootstrapCtx = { clerkUserId: 'u1', connectionId: 'c1' }
    const h = makeDraftHandlers(async () => bootstrapCtx as any)
    await expect(h.list_my_drafts()).rejects.toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    })
  })
})

describe('get_draft', () => {
  it('resolves actor and delegates to draftService.getDraft', async () => {
    mockFindActorByMemberId.mockResolvedValue({ id: 'a-1' })
    mockGetDraft.mockResolvedValue({
      id: 'd-1',
      type: 'TASK',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const h = makeDraftHandlers(async () => boundCtx)
    const out = await h.get_draft({ draftId: 'd-1' })
    expect(mockGetDraft).toHaveBeenCalledWith('d-1', 'a-1', 'ws-1')
    expect(out.draft.id).toBe('d-1')
  })

  it('propagates 404 for cross-workspace or missing draft', async () => {
    mockFindActorByMemberId.mockResolvedValue({ id: 'a-1' })
    mockGetDraft.mockRejectedValue(
      Object.assign(new Error('Draft not found'), { status: 404 })
    )
    const h = makeDraftHandlers(async () => boundCtx)
    await expect(h.get_draft({ draftId: 'd-other' })).rejects.toMatchObject({
      status: 404,
    })
  })
})
