import { makeProjectHandlers } from '@/lib/mcp/tools/projects'

const mockListProjects = jest.fn()
const mockGetProject = jest.fn()

jest.mock('@/lib/services/project.service', () => ({
  projectService: {
    listProjects: (...a: any[]) => mockListProjects(...a),
    getProject: (...a: any[]) => mockGetProject(...a),
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

describe('list_projects', () => {
  it('delegates to projectService.listProjects with workspaceId + memberId', async () => {
    mockListProjects.mockResolvedValue([
      { id: 'p1', name: 'Alpha', inProgressCount: 0 },
    ])
    const h = makeProjectHandlers(async () => boundCtx)
    const out = await h.list_projects()
    expect(mockListProjects).toHaveBeenCalledWith('ws-1', 'm-1')
    expect(out.projects).toHaveLength(1)
  })

  it('throws WORKSPACE_REQUIRED when context has no workspaceId', async () => {
    const bootstrapCtx = { clerkUserId: 'u1', connectionId: 'c1' }
    const h = makeProjectHandlers(async () => bootstrapCtx as any)
    await expect(h.list_projects()).rejects.toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    })
  })
})

describe('get_project', () => {
  it('delegates to projectService.getProject with projectId + memberId', async () => {
    mockGetProject.mockResolvedValue({ id: 'p1', name: 'Alpha' })
    const h = makeProjectHandlers(async () => boundCtx)
    const out = await h.get_project({ projectId: 'p1' })
    expect(mockGetProject).toHaveBeenCalledWith('p1', 'm-1')
    expect(out.project.id).toBe('p1')
  })

  it('propagates service 404 error', async () => {
    mockGetProject.mockRejectedValue(
      Object.assign(new Error('Project not found'), { status: 404 })
    )
    const h = makeProjectHandlers(async () => boundCtx)
    await expect(h.get_project({ projectId: 'p1' })).rejects.toMatchObject({
      status: 404,
    })
  })
})
