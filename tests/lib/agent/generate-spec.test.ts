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
    task: { update: jest.fn(), findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/pusher/server', () => ({
  pushAgentEvent: jest.fn(),
}))

jest.mock('@/lib/agent/markdown', () => ({
  markdownToHtml: jest.fn((md: string) =>
    /<(?:p|div|span|br|h[1-6]|ul|ol|li|a\b|strong|em|code|pre|blockquote|table|img\b)[>\s/]/i.test(
      md
    )
      ? md
      : `<p>${md}</p>`
  ),
  htmlToMarkdown: jest.fn((html: string) =>
    /<(?:p|div|span|br|h[1-6]|ul|ol|li|a\b|strong|em|code|pre|blockquote|table|img\b)[>\s/]/i.test(
      html
    )
      ? html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : html
  ),
}))

jest.mock('@/lib/events/dispatcher', () => ({
  dispatchEvents: jest.fn().mockResolvedValue(undefined),
}))

// Import mocked modules AFTER jest.mock calls so we get the mock instances
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent } from '@/lib/pusher/server'

const mockPrismaTaskUpdate = prisma.task.update as jest.Mock
const mockPrismaTaskFindUnique = (prisma as any).task.findUnique as jest.Mock
const mockPushAgentEvent = pushAgentEvent as jest.Mock

// ── Fixtures ───────────────────────────────────────────────────────────────

const TASK_ID = 'task-abc'

const baseTask = {
  title: 'Add dark mode toggle',
  description: 'Users want a dark mode. Add a toggle to the settings page.',
  spec: null,
  project: { id: 'proj-1' },
}

function makeApiResponse(text: string) {
  return { content: [{ type: 'text', text }] }
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  mockPrismaTaskUpdate.mockResolvedValue({})
  // State machine reads current agentStatus before each transition:
  // First call: SUBMITTED (for SUBMITTED→WORKING), Second call: WORKING (for WORKING→INPUT_REQUIRED or WORKING→FAILED)
  mockPrismaTaskFindUnique
    .mockResolvedValueOnce({ agentStatus: 'SUBMITTED' })
    .mockResolvedValueOnce({ agentStatus: 'WORKING' })
  mockPushAgentEvent.mockResolvedValue(undefined)
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
    })

    it('sets agentStatus to WORKING then INPUT_REQUIRED with spec_review reason', async () => {
      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockPrismaTaskUpdate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: TASK_ID },
          data: expect.objectContaining({ agentStatus: 'WORKING' }),
        })
      )
      // spec is now stored as HTML via markdownToHtml
      expect(mockPrismaTaskUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: TASK_ID },
          data: expect.objectContaining({
            spec: `<p>${SPEC_TEXT}</p>`,
            agentStatus: 'INPUT_REQUIRED',
            inputReason: 'spec_review',
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
      // spec_draft event also uses HTML
      expect(mockPushAgentEvent).toHaveBeenCalledWith(TASK_ID, {
        type: 'agent:spec_draft',
        spec: `<p>${SPEC_TEXT}</p>`,
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

  describe('empty API response', () => {
    it('marks task as failed and pushes agent:failed when spec text is blank', async () => {
      mockCreate.mockResolvedValue(makeApiResponse('   '))

      await generateSpecDraft(TASK_ID, baseTask)

      expect(mockPrismaTaskUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentStatus: 'FAILED',
            agentError: 'SPEC_GEN_EMPTY',
          }),
        })
      )
      expect(mockPushAgentEvent).toHaveBeenCalledWith(
        TASK_ID,
        expect.objectContaining({ type: 'agent:failed' })
      )
    })

    it('does NOT transition to INPUT_REQUIRED on empty response', async () => {
      mockCreate.mockResolvedValue(makeApiResponse(''))

      await generateSpecDraft(TASK_ID, baseTask)

      const calls: Parameters<typeof mockPrismaTaskUpdate>[] =
        mockPrismaTaskUpdate.mock.calls
      const specReviewCall = calls.find(
        ([arg]) =>
          arg?.data?.agentStatus === 'INPUT_REQUIRED' &&
          arg?.data?.inputReason === 'spec_review'
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
          data: expect.objectContaining({ agentStatus: 'FAILED' }),
        })
      )
    })
  })
})
