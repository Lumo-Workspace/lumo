/**
 * @jest-environment node
 *
 * LUM-681 Task 10 (criterion 5) — Stage-2 alignment reads the evidence-source
 * signal. `buildAlignPrompt` (exported from plan-align-client) must render a
 * `sources:` line per cluster so the model's existing customizationTrap
 * judgment ("cluster backed by a single source = trap") has real signal to
 * act on, instead of being asked to guess from the idea statements alone.
 *
 * The module also statically imports `ai` / `@ai-sdk/gateway`, which explode
 * in jest (TransformStream is not defined). Same workaround as
 * __tests__/llm/plan-align-client.test.ts: mock those modules, then
 * dynamic-import plan-align-client inside a beforeEach.
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: jest.fn((id: string) => id) }))
jest.mock('@/lib/ai/models', () => ({ REASONING_MODEL: 'openai/gpt-5.5' }))

import type { buildAlignPrompt as BuildAlignPrompt } from '@/lib/llm/plan-align-client'

let buildAlignPrompt: typeof BuildAlignPrompt

beforeEach(async () => {
  const mod = await import('@/lib/llm/plan-align-client')
  buildAlignPrompt = mod.buildAlignPrompt
})

it('alignment prompt surfaces evidence-source signal', () => {
  const prompt = buildAlignPrompt(
    {
      priority: 'ship faster',
      clusters: [
        {
          clusterId: 'c0',
          label: 'Big co ask',
          items: ['do X'],
          evidenceSources: { count: 1, channels: ['slack'] },
        },
        {
          clusterId: 'c1',
          label: 'Broad',
          items: ['do Y'],
          evidenceSources: { count: 5, channels: ['slack', 'web'] },
        },
      ],
    },
    true
  )
  expect(prompt).toContain('sources: 1 (slack)')
  expect(prompt).toContain('sources: 5 (slack, web)')
})

it('renders "sources: none" when a cluster has no evidence', () => {
  const prompt = buildAlignPrompt(
    {
      priority: 'ship faster',
      clusters: [{ clusterId: 'c0', label: 'No evidence', items: ['do Z'] }],
    },
    true
  )
  expect(prompt).toContain('sources: none')
})
