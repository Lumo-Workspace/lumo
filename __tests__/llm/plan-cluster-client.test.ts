jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import { generateObject } from 'ai'
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

  it('throws when the model drops an input idea id (silent partial result)', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        clusters: [{ name: 'Theming', thrust: 'x', ideaIds: ['i1', 'i2'] }],
        orphans: [], // i3 and i4 dropped
      },
    } as any)

    await expect(callPlanClusterLLM(IDEAS)).rejects.toThrow(/dropped/)
  })

  it('throws when the model invents an id not in the input pool', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        clusters: [
          { name: 'Theming', thrust: 'x', ideaIds: ['i1', 'i2'] },
          { name: 'Dev', thrust: 'y', ideaIds: ['i3'] },
        ],
        orphans: ['i4', 'i99'], // i99 hallucinated
      },
    } as any)

    await expect(callPlanClusterLLM(IDEAS)).rejects.toThrow(/unknown idea id/)
  })

  it('throws when the model assigns the same id twice', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        clusters: [
          { name: 'Theming', thrust: 'x', ideaIds: ['i1', 'i2'] },
          { name: 'Dev', thrust: 'y', ideaIds: ['i3', 'i4'] },
        ],
        orphans: ['i4'], // i4 duplicated
      },
    } as any)

    await expect(callPlanClusterLLM(IDEAS)).rejects.toThrow(/more than once/)
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
