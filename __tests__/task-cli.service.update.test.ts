/**
 * @jest-environment node
 */
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: jest.fn(),
    findActorByMemberId: jest.fn(),
    findAllWithProfilesForCli: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/session-binding-guard', () => ({
  enforceSessionBinding: jest.fn().mockResolvedValue({ advisory: null }),
}))

import { taskService } from '@/lib/services/task.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskCliService } from '@/lib/services/task-cli.service'
import { enforceSessionBinding } from '@/lib/services/session-binding-guard'

const mockFindSessionWs = sessionRepository.findWorkspaceId as jest.Mock

const mockResolveIdentifier = taskService.resolveIdentifier as jest.Mock
const mockGetDetail = taskService.getTaskDetail as jest.Mock
const mockUpdate = taskService.updateTaskWithSideEffects as jest.Mock
const mockFindMember = memberRepository.findByWorkspaceAndClerkId as jest.Mock
const mockFindActor = memberRepository.findActorByMemberId as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveIdentifier.mockResolvedValue({
    id: 'task_1',
    identifier: 'LUM-48',
    title: 'Old title',
    status: 'TODO',
  })
  mockGetDetail.mockResolvedValue({
    id: 'task_1',
    project: { workspaceId: 'ws_1' },
    status: 'TODO',
  })
  mockFindMember.mockResolvedValue({ id: 'mem_1' })
  mockFindActor.mockResolvedValue({ id: 'actor_caller' })
  mockUpdate.mockResolvedValue({
    task: {
      id: 'task_1',
      title: 'New title',
      teamIdentifier: 'LUM',
      number: 48,
      tags: [],
    },
  })
})

describe('taskCliService.updateFromCli', () => {
  it('404s when identifier cannot be resolved', async () => {
    mockResolveIdentifier.mockResolvedValueOnce(null)
    await expect(
      taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-999',
        input: { title: 'x' },
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('passes title/description/status/priority straight through', async () => {
    await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      input: {
        title: 'New title',
        description: 'Body',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
      },
    })
    expect(mockUpdate).toHaveBeenCalledWith(
      'task_1',
      {
        title: 'New title',
        description: 'Body',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
      },
      expect.any(Object),
      'actor_caller',
      'clerk_1',
      // No X-Lumo-Session-Id supplied → null (Web-UI-equivalent attribution).
      null
    )
  })

  it('resolves assigneeRef "me" to caller actor id', async () => {
    await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      input: { assigneeRef: 'me' },
    })
    const callInput = mockUpdate.mock.calls[0][1]
    expect(callInput.assigneeActorId).toBe('actor_caller')
  })

  it('passes assigneeActorId: null when assigneeRef is null (clear)', async () => {
    await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      input: { assigneeRef: null },
    })
    const callInput = mockUpdate.mock.calls[0][1]
    expect(callInput.assigneeActorId).toBeNull()
  })

  it('passes description: null to clear the field', async () => {
    await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      input: { description: null },
    })
    const callInput = mockUpdate.mock.calls[0][1]
    expect(callInput.description).toBeNull()
  })

  it('returns identifier + URL shape matching createFromCli', async () => {
    const res = await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      input: { title: 'New title' },
    })
    expect(res).toMatchObject({
      id: 'task_1',
      identifier: 'LUM-48',
      title: 'New title',
    })
    expect(res.url).toContain('/workspace/ws/my-tasks/LUM-48')
  })

  describe('sourceSessionId attribution (LUM-165)', () => {
    it('forwards the session id once it is confirmed to belong to this workspace', async () => {
      mockFindSessionWs.mockResolvedValue({ workspaceId: 'ws_1' })

      await taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-48',
        sourceSessionId: 'sess_ok',
        input: { status: 'DONE' },
      })

      expect(mockFindSessionWs).toHaveBeenCalledWith('sess_ok')
      expect(mockUpdate.mock.calls[0][5]).toBe('sess_ok')
    })

    it('drops a session id from another workspace (no cross-workspace attribution)', async () => {
      mockFindSessionWs.mockResolvedValue({ workspaceId: 'ws_other' })

      await taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-48',
        sourceSessionId: 'sess_foreign',
        input: { status: 'DONE' },
      })

      expect(mockUpdate.mock.calls[0][5]).toBeNull()
    })

    it('drops an unknown session id', async () => {
      mockFindSessionWs.mockResolvedValue(null)

      await taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-48',
        sourceSessionId: 'sess_ghost',
        input: { status: 'DONE' },
      })

      expect(mockUpdate.mock.calls[0][5]).toBeNull()
    })

    it('skips the session lookup entirely when no id is supplied', async () => {
      await taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-48',
        input: { status: 'DONE' },
      })

      expect(mockFindSessionWs).not.toHaveBeenCalled()
      expect(mockUpdate.mock.calls[0][5]).toBeNull()
    })
  })
})

describe('updateFromCli session-binding guard', () => {
  const enforce = enforceSessionBinding as jest.Mock

  beforeEach(() => {
    enforce.mockResolvedValue({ advisory: null })
  })

  it('invokes the guard with source=bearer + action=status change on a status transition', async () => {
    await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      sourceSessionId: 'sess_abc',
      input: { status: 'IN_PROGRESS' },
    })
    expect(enforce).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'bearer',
        sessionId: 'sess_abc',
        action: 'status change',
      })
    )
  })

  it('does NOT invoke the guard when no status field is present', async () => {
    await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      sourceSessionId: 'sess_abc',
      input: { title: 'just a title change' },
    })
    expect(enforce).not.toHaveBeenCalled()
  })

  it('propagates a 409 from a mismatch (work is blocked)', async () => {
    enforce.mockRejectedValue(
      Object.assign(new Error('bound to LUM-487'), { status: 409 })
    )
    await expect(
      taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-48',
        sourceSessionId: 'sess_mismatch',
        input: { status: 'IN_PROGRESS' },
      })
    ).rejects.toMatchObject({ status: 409 })
  })
})
