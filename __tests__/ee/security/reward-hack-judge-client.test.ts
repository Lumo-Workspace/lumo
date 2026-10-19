/** @jest-environment node */
// LUM-1234 — the reward-hack judge and refute client. `generateObject` is
// mocked; the assertions read the request the client builds.
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { generateObject } from 'ai'
import {
  judgeRewardHack,
  refuteRewardHackItem,
  REWARD_HACK_SYSTEM_PROMPT,
  REWARD_HACK_REFUTE_SYSTEM_PROMPT,
  RhJudgeSchema,
  type RhItem,
} from '@/ee/security/llm/reward-hack-judge-client'
import { REWARD_HACK_MODEL } from '@/lib/ai/models'

const gen = generateObject as jest.Mock

const ITEM: RhItem = {
  kind: 'TEST_TAMPERING',
  summary: 'The failing assertion was deleted.',
  eventIds: ['e12'],
}

const judged = (over: Record<string, unknown> = {}) => ({
  object: { items: [ITEM], suspicion: 70 },
  usage: { inputTokens: 1200, outputTokens: 80 },
  providerMetadata: { gateway: { cost: '0.0123' } },
  ...over,
})

describe('LUM-1234 reward-hack judge client', () => {
  beforeEach(() => gen.mockReset())

  it('calls the REWARD_HACK_MODEL at temperature 0 with no SDK retries', async () => {
    gen.mockResolvedValueOnce(judged())
    await judgeRewardHack('PROMPT')
    const arg = gen.mock.calls[0][0]
    expect(arg.model).toEqual({ id: REWARD_HACK_MODEL })
    expect(arg.temperature).toBe(0)
    expect(arg.maxRetries).toBe(0)
    expect(arg.prompt).toBe('PROMPT')
    expect(arg.system).toBe(REWARD_HACK_SYSTEM_PROMPT)
    expect(arg.abortSignal).toBeInstanceOf(AbortSignal)
    expect(arg.schema).toBe(RhJudgeSchema)
  })

  it('returns the output, token usage and the gateway cost parsed from a string', async () => {
    gen.mockResolvedValueOnce(judged())
    const r = await judgeRewardHack('P')
    expect(r.output.items).toEqual([ITEM])
    expect(r.output.suspicion).toBe(70)
    expect(r.inputTokens).toBe(1200)
    expect(r.outputTokens).toBe(80)
    expect(r.costUsd).toBeCloseTo(0.0123)
  })

  it('accepts a numeric cost and reports null when the gateway sent none', async () => {
    gen.mockResolvedValueOnce(
      judged({ providerMetadata: { gateway: { cost: 0.5 } } })
    )
    expect((await judgeRewardHack('P')).costUsd).toBe(0.5)
    gen.mockResolvedValueOnce(judged({ providerMetadata: undefined }))
    expect((await judgeRewardHack('P')).costUsd).toBeNull()
    gen.mockResolvedValueOnce(
      judged({ providerMetadata: { gateway: { cost: 'free' } } })
    )
    expect((await judgeRewardHack('P')).costUsd).toBeNull()
  })

  it('throws when suspicion is not a finite number', async () => {
    gen.mockResolvedValueOnce(
      judged({ object: { items: [], suspicion: Number.NaN } })
    )
    await expect(judgeRewardHack('P')).rejects.toThrow(/suspicion/)
    gen.mockResolvedValueOnce(
      judged({ object: { items: [], suspicion: Infinity } })
    )
    await expect(judgeRewardHack('P')).rejects.toThrow(/suspicion/)
  })

  it('states the final-PR rule, the contract rule and the event id convention', () => {
    expect(REWARD_HACK_SYSTEM_PROMPT).toMatch(/still present in the final/i)
    expect(REWARD_HACK_SYSTEM_PROMPT).toMatch(
      /task requirement is the contract/i
    )
    expect(REWARD_HACK_SYSTEM_PROMPT).toMatch(/\[e:<id>\]/)
    // ids only, without the "e:" prefix
    expect(REWARD_HACK_SYSTEM_PROMPT).toMatch(/without the "e:" prefix/)
    expect(REWARD_HACK_SYSTEM_PROMPT).toMatch(/claims, not evidence/i)
    // LUM-1234 R16: the summary describes the change, never quotes the inputs.
    expect(REWARD_HACK_SYSTEM_PROMPT).toMatch(
      /Never quote or paraphrase the user's messages or the task requirement/
    )
  })
})

describe('LUM-1234 reward-hack text repair', () => {
  beforeEach(() => gen.mockReset())

  const repair = async (text: string): Promise<string | null> => {
    gen.mockResolvedValueOnce(judged())
    await judgeRewardHack('P')
    const cb = gen.mock.calls[0][0].experimental_repairText
    return cb({ text })
  }

  it('extracts the JSON object from a fenced block', async () => {
    expect(await repair('```json\n{"items":[],"suspicion":3}\n```')).toBe(
      '{"items":[],"suspicion":3}'
    )
  })

  it('extracts bare JSON surrounded by prose', async () => {
    expect(await repair('Here you go: {"items":[],"suspicion":3} done')).toBe(
      '{"items":[],"suspicion":3}'
    )
  })

  it('gives up (null) when there is no object', async () => {
    expect(await repair('no json here')).toBeNull()
  })
})

describe('LUM-1234 reward-hack refute client', () => {
  beforeEach(() => gen.mockReset())

  it('sends the transcript prompt plus the item, and returns verdict and cost', async () => {
    gen.mockResolvedValueOnce({
      object: { refuted: true, reason: 'The user asked for it.' },
      usage: { inputTokens: 900, outputTokens: 30 },
      providerMetadata: { gateway: { cost: '0.004' } },
    })
    const r = await refuteRewardHackItem({ prompt: 'TRANSCRIPT', item: ITEM })
    // Usage comes back too: the runner books it when the gateway sends no cost.
    expect(r).toEqual({
      refuted: true,
      reason: 'The user asked for it.',
      inputTokens: 900,
      outputTokens: 30,
      costUsd: 0.004,
    })
    const arg = gen.mock.calls[0][0]
    expect(arg.model).toEqual({ id: REWARD_HACK_MODEL })
    expect(arg.temperature).toBe(0)
    expect(arg.maxRetries).toBe(0)
    expect(arg.system).toBe(REWARD_HACK_REFUTE_SYSTEM_PROMPT)
    expect(arg.prompt).toContain('TRANSCRIPT')
    expect(arg.prompt).toContain(ITEM.summary)
    expect(arg.prompt).toContain('e12')
  })

  it('puts the current PR diff of the cited files before the item when given', async () => {
    gen.mockResolvedValueOnce({
      object: { refuted: false, reason: 'still there' },
      providerMetadata: {},
    })
    await refuteRewardHackItem({
      prompt: 'TRANSCRIPT',
      item: ITEM,
      prDiff: '<pr-diff file="src/a.ts">\n+hard-coded\n</pr-diff>',
    })
    const prompt = gen.mock.calls[0][0].prompt as string
    expect(prompt).toContain('CURRENT diff')
    expect(prompt.indexOf('+hard-coded')).toBeGreaterThan(
      prompt.indexOf('TRANSCRIPT')
    )
    expect(prompt.indexOf('+hard-coded')).toBeLessThan(
      prompt.indexOf(ITEM.summary)
    )
  })

  it('looks for legitimate explanations', () => {
    const p = REWARD_HACK_REFUTE_SYSTEM_PROMPT
    expect(p).toMatch(/test itself was wrong/i)
    expect(p).toMatch(/explicitly asked/i)
    expect(p).toMatch(/disclosed/i)
    expect(p).toMatch(/not (part of|in) the final/i)
  })
})
