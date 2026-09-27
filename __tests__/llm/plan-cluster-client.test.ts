jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { generateObject } from 'ai'
import { logger } from '@/lib/logger'
import {
  callPlanClusterLLM,
  buildPlanClusterPrompt,
  type ClusterIdeaInput,
} from '@/lib/llm/plan-cluster-client'

const mockGenerateObject = generateObject as jest.MockedFunction<
  typeof generateObject
>

const IDEAS: ClusterIdeaInput[] = [
  { id: 'i1', statement: 'Add dark mode', sourceContext: 'from #design' },
  { id: 'i2', statement: 'High-contrast theme' },
  { id: 'i3', statement: 'Faster CI pipeline' },
  { id: 'i4', statement: 'Buy a new coffee machine' },
]

function schemaConformingOutput() {
  return {
    object: {
      clusters: [
        {
          name: 'Theming',
          thrust: 'Give users visual comfort options',
          ideaIds: ['i1', 'i2'],
        },
        {
          name: 'Dev velocity',
          thrust: 'Speed up the delivery loop',
          ideaIds: ['i3'],
        },
      ],
      orphans: ['i4'],
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('callPlanClusterLLM', () => {
  it('returns a schema-conforming { clusters, orphans } result', async () => {
    mockGenerateObject.mockResolvedValueOnce(schemaConformingOutput() as any)

    const result = await callPlanClusterLLM(IDEAS)

    expect(result.clusters).toHaveLength(2)
    expect(result.clusters[0]).toEqual({
      name: 'Theming',
      thrust: 'Give users visual comfort options',
      ideaIds: ['i1', 'i2'],
    })
    expect(result.orphans).toEqual(['i4'])
  })

  it('passes GENERATION_MODEL, the schema and the system prompt to generateObject', async () => {
    mockGenerateObject.mockResolvedValueOnce(schemaConformingOutput() as any)

    await callPlanClusterLLM(IDEAS)

    const arg = mockGenerateObject.mock.calls[0]![0] as any
    expect(arg.model).toBe('mocked-model')
    expect(arg.schema).toBeDefined()
    expect(arg.system).toContain('design-thinking')
    expect(arg.prompt).toContain('Add dark mode')
    expect(arg.prompt).toContain('i4')
  })

  it('propagates a throw when the SDK exhausts retries on malformed output (never returns a partial result)', async () => {
    mockGenerateObject.mockRejectedValueOnce(
      new Error('No object generated: response did not match schema')
    )

    await expect(callPlanClusterLLM(IDEAS)).rejects.toThrow(/schema/)
  })

  it('omitted idea ids are reconciled into orphans not dropped', async () => {
    // Model returns only i1, i2 — i3 and i4 are silently omitted (the exact
    // failure mode a long-cuid pool hits: the model echoes one id short).
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        clusters: [{ name: 'Theming', thrust: 'x', ideaIds: ['i1', 'i2'] }],
        orphans: [],
      },
    } as any)

    const result = await callPlanClusterLLM(IDEAS)

    // No throw: every input id survives, the omitted ones land in orphans.
    const assigned = [
      ...result.clusters.flatMap(c => c.ideaIds),
      ...result.orphans,
    ]
    expect(assigned.sort()).toEqual(['i1', 'i2', 'i3', 'i4'])
    expect(result.orphans).toEqual(expect.arrayContaining(['i3', 'i4']))
    // No idea is ever lost — the partition still covers the whole input.
    expect(new Set(assigned).size).toBe(IDEAS.length)
  })

  it('unknown and duplicate ids are tolerated not thrown', async () => {
    // Model hallucinates i99 (not in the pool) and repeats i4 across a cluster
    // and orphans. A single such blemish must not hard-fail the whole run.
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        clusters: [
          { name: 'Theming', thrust: 'x', ideaIds: ['i1', 'i2'] },
          { name: 'Dev', thrust: 'y', ideaIds: ['i3', 'i4'] },
        ],
        orphans: ['i4', 'i99'],
      },
    } as any)

    const result = await callPlanClusterLLM(IDEAS)

    const assigned = [
      ...result.clusters.flatMap(c => c.ideaIds),
      ...result.orphans,
    ]
    // Unknown id excluded; duplicate collapsed to one; real ids all present once.
    expect(assigned).not.toContain('i99')
    expect(assigned.filter(id => id === 'i4')).toHaveLength(1)
    expect(new Set(assigned)).toEqual(new Set(['i1', 'i2', 'i3', 'i4']))
    // The blemish is surfaced, not swallowed silently.
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('buildPlanClusterPrompt', () => {
  it('includes each idea id, statement, and any source context', () => {
    const prompt = buildPlanClusterPrompt(IDEAS)
    expect(prompt).toContain('id: i1')
    expect(prompt).toContain('Add dark mode')
    expect(prompt).toContain('context: from #design')
    // i2 has no context — no dangling context line for it
    expect(prompt).toContain('id: i2')
  })

  it('singularises the header for a one-idea pool', () => {
    const prompt = buildPlanClusterPrompt([IDEAS[0]!])
    expect(prompt).toContain('1 unprocessed idea)')
  })
})
