/**
 * @jest-environment node
 *
 * LUM-984 — the offline-experiment model call: gateway model, deterministic
 * single shot, prompt vs messages, repair hook. The SDK is mocked.
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: jest.fn((id: string) => `gw:${id}`),
}))

import { generateObject } from 'ai'
import { z } from 'zod'
import { generateEvalObject } from '@/lib/llm/offline-eval-client'

const mockGenerate = generateObject as jest.Mock
const schema = z.object({ suspicion: z.number() })

beforeEach(() => {
  mockGenerate.mockReset()
  mockGenerate.mockResolvedValue({
    object: { suspicion: 0.4 },
    usage: { inputTokens: 10, outputTokens: 2 },
    providerMetadata: { gateway: { cost: '0.001' } },
  })
})

describe('generateEvalObject', () => {
  it('calls the ZDR gateway once, at temperature 0, with the prompt', async () => {
    const r = await generateEvalObject({
      model: 'anthropic/claude-sonnet-4.6',
      schema,
      system: 'sys',
      prompt: 'judge this',
      maxOutputTokens: 100,
      timeoutMs: 1000,
    })
    expect(r).toEqual({
      object: { suspicion: 0.4 },
      usage: { inputTokens: 10, outputTokens: 2 },
      providerMetadata: { gateway: { cost: '0.001' } },
    })
    const call = mockGenerate.mock.calls[0]![0]
    expect(call).toMatchObject({
      model: 'gw:anthropic/claude-sonnet-4.6',
      system: 'sys',
      prompt: 'judge this',
      maxOutputTokens: 100,
      temperature: 0,
      maxRetries: 0,
    })
    expect(call.messages).toBeUndefined()
    expect(call.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('passes messages instead of a prompt and wires the repair hook', async () => {
    await generateEvalObject({
      model: 'm',
      schema,
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxOutputTokens: 100,
      timeoutMs: 1000,
      repairText: t => (t === 'broken' ? '{"suspicion":1}' : null),
    })
    const call = mockGenerate.mock.calls[0]![0]
    expect(call.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(call.prompt).toBeUndefined()
    await expect(
      call.experimental_repairText({ text: 'broken' })
    ).resolves.toBe('{"suspicion":1}')
    await expect(call.experimental_repairText({ text: 'x' })).resolves.toBe(
      null
    )
  })

  it('gives up on unparseable text when no repair hook is set', async () => {
    await generateEvalObject({
      model: 'm',
      schema,
      system: 'sys',
      prompt: 'p',
      maxOutputTokens: 10,
      timeoutMs: 1000,
    })
    const call = mockGenerate.mock.calls[0]![0]
    await expect(call.experimental_repairText({ text: 'x' })).resolves.toBe(
      null
    )
  })

  it('propagates SDK errors to the caller', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('timeout'))
    await expect(
      generateEvalObject({
        model: 'm',
        schema,
        system: 's',
        prompt: 'p',
        maxOutputTokens: 10,
        timeoutMs: 1000,
      })
    ).rejects.toThrow('timeout')
  })
})
