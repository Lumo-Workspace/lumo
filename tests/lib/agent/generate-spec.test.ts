import { generateSpecDraft } from '@/lib/agent/generate-spec'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockCreate = jest.fn()
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { update: jest.fn() },
    workspaceMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
  },
}))

jest.mock('@/lib/pusher/server', () => ({
  pushAgentEvent: jest.fn(),
}))

// Import mocked modules AFTER jest.mock calls so we get the mock instances
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent } from '@/lib/pusher/server'

const mockPrismaTaskUpdate = prisma.task.update as jest.Mock
const mockWorkspaceMemberFindUnique = prisma.workspaceMember
  .findUnique as jest.Mock
const mockWorkspaceMemberFindMany = prisma.workspaceMember.findMany as jest.Mock
const mockNotificationCreate = prisma.notification.create as jest.Mock
const mockNotificationCreateMany = prisma.notification.createMany as jest.Mock
const mockPushAgentEvent = pushAgentEvent as jest.Mock

// ── Fixtures ───────────────────────────────────────────────────────────────

const TASK_ID = 'task-abc'

const baseTask = {
  title: 'Add dark mode toggle',
  description: 'Users want a dark mode. Add a toggle to the settings page.',
  spec: null,
  project: { workspaceId: 'ws-1', defaultReviewerId: null },
  reviewerActorId: null,
}

function makeApiResponse(text: string) {
  return { content: [{ type: 'text', text }] }
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  mockPrismaTaskUpdate.mockResolvedValue({})
  mockPushAgentEvent.mockResolvedValue(undefined)
  mockNotificationCreate.mockResolvedValue({})
  mockNotificationCreateMany.mockResolvedValue({ count: 0 })
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('generateSpecDraft', () => {
  describe('missing API key', () => {
    it('throws immediately when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY
      await expect(generateSpecDraft(TASK_ID, baseTask)).rejects.toThrow(
        'ANTHROPIC_API_KEY not configured'
      )
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe('successful spec generation', () => {
    const SPEC_TEXT =
      '## Requirements\n- Toggle in settings\n\n## Test Cases\n- Toggle persists'

    beforeEach(() => {
      mockCreate.mockResolvedValue(makeApiResponse(SPEC_TEXT))
      mockWorkspaceMemberFindMany.mockResolvedValue([])
    })

    it('sets agentStatus to running then spec_review', async () => {
      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockPrismaTaskUpdate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: TASK_ID },
          data: expect.objectContaining({ agentStatus: 'running' }),
        })
      )
      expect(mockPrismaTaskUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: TASK_ID },
          data: expect.objectContaining({
            spec: SPEC_TEXT,
            agentStatus: 'spec_review',
          }),
        })
      )
    })

    it('pushes agent:started, agent:progress, and agent:spec_draft events', async () => {
      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockPushAgentEvent).toHaveBeenCalledWith(TASK_ID, {
        type: 'agent:started',
      })
      expect(mockPushAgentEvent).toHaveBeenCalledWith(
        TASK_ID,
        expect.objectContaining({ type: 'agent:progress' })
      )
      expect(mockPushAgentEvent).toHaveBeenCalledWith(TASK_ID, {
        type: 'agent:spec_draft',
        spec: SPEC_TEXT,
      })
    })

    it('includes task title and description in the Anthropic user message', async () => {
      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(baseTask.title),
            }),
          ],
        })
      )
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.stringContaining(baseTask.description as string),
            }),
          ],
        })
      )
    })

    it('uses fallback text when description is null', async () => {
      await generateSpecDraft(TASK_ID, { ...baseTask, description: null })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.stringContaining('no description provided'),
            }),
          ],
        })
      )
    })
  })

  describe('reviewer notification', () => {
    const SPEC_TEXT = '## Requirements\n- ...'

    beforeEach(() => {
      mockCreate.mockResolvedValue(makeApiResponse(SPEC_TEXT))
    })

    it('notifies the task-level reviewer when set', async () => {
      const task = { ...baseTask, reviewerActorId: 'member-reviewer' }
      mockWorkspaceMemberFindUnique.mockResolvedValue({
        clerkId: 'clerk-reviewer',
      })

      await generateSpecDraft(TASK_ID, task)

      expect(mockWorkspaceMemberFindUnique).toHaveBeenCalledWith({
        where: { id: 'member-reviewer' },
        select: { clerkId: true },
      })
      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TASK_SPEC_READY',
            recipientId: 'clerk-reviewer',
            taskId: TASK_ID,
          }),
        })
      )
    })

    it('falls back to project defaultReviewerId when task reviewerId is null', async () => {
      const task = {
        ...baseTask,
        reviewerActorId: null,
        project: { workspaceId: 'ws-1', defaultReviewerId: 'member-default' },
      }
      mockWorkspaceMemberFindUnique.mockResolvedValue({
        clerkId: 'clerk-default',
      })

      await generateSpecDraft(TASK_ID, task)

      expect(mockWorkspaceMemberFindUnique).toHaveBeenCalledWith({
        where: { id: 'member-default' },
        select: { clerkId: true },
      })
      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TASK_SPEC_READY',
            recipientId: 'clerk-default',
          }),
        })
      )
    })

    it('notifies all workspace owners when no reviewer is configured', async () => {
      mockWorkspaceMemberFindMany.mockResolvedValue([
        { clerkId: 'clerk-owner-1' },
        { clerkId: 'clerk-owner-2' },
      ])

      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockWorkspaceMemberFindMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', role: 'OWNER' },
        select: { clerkId: true },
      })
      expect(mockNotificationCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              recipientId: 'clerk-owner-1',
              type: 'TASK_SPEC_READY',
            }),
            expect.objectContaining({
              recipientId: 'clerk-owner-2',
              type: 'TASK_SPEC_READY',
            }),
          ]),
        })
      )
    })

    it('does not notify anyone when reviewer member cannot be found', async () => {
      const task = { ...baseTask, reviewerActorId: 'member-gone' }
      mockWorkspaceMemberFindUnique.mockResolvedValue(null)

      await generateSpecDraft(TASK_ID, task)

      expect(mockNotificationCreate).not.toHaveBeenCalled()
    })

    it('does not call createMany when there are no workspace owners', async () => {
      mockWorkspaceMemberFindMany.mockResolvedValue([])

      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockNotificationCreateMany).not.toHaveBeenCalled()
    })
  })

  describe('empty API response', () => {
    it('marks task as failed and pushes agent:failed when spec text is blank', async () => {
      mockCreate.mockResolvedValue(makeApiResponse('   '))

      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockPrismaTaskUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentStatus: 'failed',
            agentError: 'SPEC_GEN_EMPTY',
          }),
        })
      )
      expect(mockPushAgentEvent).toHaveBeenCalledWith(
        TASK_ID,
        expect.objectContaining({ type: 'agent:failed' })
      )
    })

    it('does NOT transition to spec_review on empty response', async () => {
      mockCreate.mockResolvedValue(makeApiResponse(''))

      await generateSpecDraft(TASK_ID, baseTask)

      const calls: Parameters<typeof mockPrismaTaskUpdate>[] =
        mockPrismaTaskUpdate.mock.calls
      const specReviewCall = calls.find(
        ([arg]) => arg?.data?.agentStatus === 'spec_review'
      )
      expect(specReviewCall).toBeUndefined()
    })

    it('marks task as failed when API returns non-text content', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tu_1' }],
      })

      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockPrismaTaskUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ agentStatus: 'failed' }),
        })
      )
    })
  })
})
