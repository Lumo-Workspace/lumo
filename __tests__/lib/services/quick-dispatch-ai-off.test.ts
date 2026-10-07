/**
 * @jest-environment node
 */
/**
 * LUM-1019 — quick dispatch on a deployment that cannot serve the model (no
 * AI backend, or a direct provider with no mapping for it): rule-parsed
 * actions still go through, and input only AI could parse reports the 503
 * instead of failing as a 500. The real router decides, from the env.
 */
const generateObjectMock = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: unknown[]) => generateObjectMock(...a),
}))
jest.mock('@clerk/nextjs/server', () => ({ clerkClient: jest.fn() }))
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/repositories', () => ({
  projectRepository: {},
  memberRepository: { findByWorkspaceAndClerkId: jest.fn() },
  taskRepository: {},
}))
const parseMock = jest.fn()
jest.mock('@/lib/quick-dispatch/rule-parser', () => ({
  parseQuickDispatch: (...a: unknown[]) => parseMock(...a),
}))

import { GENERATION_MODEL } from '@/lib/ai/models'
import { quickDispatchService } from '@/lib/services/quick-dispatch.service'
import { memberRepository } from '@/lib/repositories'

const AI_ENV = [
  'AI_PROVIDER',
  'AI_GATEWAY_API_KEY',
  'VERCEL',
  'VERCEL_OIDC_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'OPENAI_COMPATIBLE_BASE_URL',
]
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  jest.clearAllMocks()
  for (const k of AI_ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of AI_ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const ruleAction = {
  type: 'update',
  taskId: 't-1',
  identifier: 'LUM-1',
  changes: { status: 'DONE' },
  confidence: 'high',
}

describe('quickDispatchService.parseWithAI without AI configured', () => {
  it('returns the rule-parsed actions and skips the model', async () => {
    parseMock.mockReturnValue({ actions: [ruleAction], unparsed: 'and more' })
    const result = await quickDispatchService.parseWithAI(
      'LUM-1 done and more',
      'ws-1',
      'user-1'
    )
    expect(result.actions).toEqual([ruleAction])
    expect(generateObjectMock).not.toHaveBeenCalled()
    expect(memberRepository.findByWorkspaceAndClerkId).not.toHaveBeenCalled()
  })

  it('reports AI_NOT_CONFIGURED (503) when only AI could parse the input', async () => {
    parseMock.mockReturnValue({ actions: [], unparsed: 'free text' })
    await expect(
      quickDispatchService.parseWithAI('free text', 'ws-1', 'user-1')
    ).rejects.toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' })
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('Anthropic key but no mapping for the model: same degrade, AI_MODEL_UNAVAILABLE', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    // Only Claude ids map to Anthropic, and GENERATION_MODEL is not one.
    expect(GENERATION_MODEL).not.toMatch(/^anthropic\//)
    parseMock.mockReturnValue({ actions: [ruleAction], unparsed: 'and more' })
    const result = await quickDispatchService.parseWithAI(
      'LUM-1 done and more',
      'ws-1',
      'user-1'
    )
    expect(result.actions).toEqual([ruleAction])

    parseMock.mockReturnValue({ actions: [], unparsed: 'free text' })
    await expect(
      quickDispatchService.parseWithAI('free text', 'ws-1', 'user-1')
    ).rejects.toMatchObject({ status: 503, code: 'AI_MODEL_UNAVAILABLE' })
    expect(generateObjectMock).not.toHaveBeenCalled()
  })
})
