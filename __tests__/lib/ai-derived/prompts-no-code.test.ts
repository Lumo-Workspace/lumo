/**
 * LUM-917 — every prompt that writes a memory, a session summary or a run
 * summary carries the no-code rule.
 */
jest.mock('ai', () => ({
  generateObject: jest.fn(),
  jsonSchema: (s: unknown) => s,
}))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import { generateObject } from 'ai'
import { DERIVED_CONTENT_NO_CODE_RULE } from '@/lib/ai-derived/strip-code'
import { buildLayer1ExtractPrompt } from '@/lib/services/memory/layer1-prompt'
import { buildLayer1ReconcilePrompt } from '@/lib/services/memory/layer1-reconcile-prompt'
import { buildLayer2ExtractPrompt } from '@/lib/services/memory/layer2-prompt'
import { buildLayer2ReconcilePrompt } from '@/lib/services/memory/layer2-reconcile-prompt'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'
import { generateStructuredSummary } from '@/lib/services/session-summary/templates'

const mockGenerateObject = generateObject as jest.Mock
const TASK = { id: 't1', title: 'T', description: null }

describe('no-code rule in derived-content prompts (LUM-917)', () => {
  it('memory extraction and reconcile prompts carry it', () => {
    expect(
      buildLayer1ExtractPrompt({ task: TASK, turnEvents: [] } as never).system
    ).toContain(DERIVED_CONTENT_NO_CODE_RULE)
    expect(
      buildLayer1ReconcilePrompt({
        task: TASK,
        candidates: [],
        neighborsByCandidate: [],
      }).system
    ).toContain(DERIVED_CONTENT_NO_CODE_RULE)
    expect(
      buildLayer2ExtractPrompt({
        project: { id: 'p', name: 'P', workspaceId: 'w' },
        taskMemories: [],
        existingProjectMemories: [],
        constitution: { claudeMd: null, agentsMd: null },
      } as never).system
    ).toContain(DERIVED_CONTENT_NO_CODE_RULE)
    expect(
      buildLayer2ReconcilePrompt({
        project: { id: 'p', name: 'P' },
        candidates: [],
        neighborsByCandidate: [],
      }).system
    ).toContain(DERIVED_CONTENT_NO_CODE_RULE)
  })

  it('the run summary call carries it', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { summary: 'ok' } })
    await callRunSummaryLLM({ taskTitle: 'T', eventLog: 'Edit /a.ts' })
    expect(mockGenerateObject.mock.calls[0]![0].system).toContain(
      DERIVED_CONTENT_NO_CODE_RULE
    )
  })

  it('the session summary call carries it', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: {} })
    await generateStructuredSummary({
      kind: 'mixed',
      compactLog: 'Edit /a.ts',
      truncatedToolCount: 0,
      sessionMeta: { cwd: null, durationMs: 1, toolCallCount: 1 },
    }).catch(() => undefined)
    const calls = mockGenerateObject.mock.calls
    expect(calls[calls.length - 1]![0].system).toContain(
      DERIVED_CONTENT_NO_CODE_RULE
    )
  })
})
