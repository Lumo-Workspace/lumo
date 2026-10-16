/** @jest-environment node */
import type { ModelMessage } from 'ai'
import {
  ANTHROPIC_CACHE_BREAKPOINT,
  cacheUsageOf,
  markCacheBreakpoint,
  withCacheBreakpoint,
} from '@/lib/ai/prompt-cache'

describe('LUM-1224 prompt cache helpers', () => {
  it('withCacheBreakpoint adds anthropic cacheControl and keeps the content and other options', () => {
    const m: ModelMessage = {
      role: 'user',
      content: 'hello',
      providerOptions: {
        gateway: { order: ['x'] },
        anthropic: { other: 1 },
      },
    }
    const out = withCacheBreakpoint(m)
    expect(out.content).toBe('hello')
    expect(out.providerOptions).toEqual({
      gateway: { order: ['x'] },
      anthropic: { other: 1, cacheControl: { type: 'ephemeral' } },
    })
    // Never mutates the input.
    expect(m.providerOptions!.anthropic).toEqual({ other: 1 })
    expect(withCacheBreakpoint({ role: 'user', content: 'x' })).toEqual({
      role: 'user',
      content: 'x',
      providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
    })
  })

  it('markCacheBreakpoint marks exactly one message, and none for an index outside the list', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]
    const out = markCacheBreakpoint(msgs, 1)
    expect(out[0]).toBe(msgs[0])
    expect(out[1]!.providerOptions).toEqual(ANTHROPIC_CACHE_BREAKPOINT)
    expect(msgs[1]!.providerOptions).toBeUndefined()
    expect(markCacheBreakpoint(msgs, 5)).toEqual(msgs)
    expect(markCacheBreakpoint(msgs, -1)).toEqual(msgs)
  })

  it('cacheUsageOf reads the cache share of a usage, 0 when absent', () => {
    expect(
      cacheUsageOf({
        inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 40 },
      })
    ).toEqual({ cacheReadTokens: 900, cacheWriteTokens: 40 })
    expect(cacheUsageOf({})).toEqual({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(cacheUsageOf(undefined)).toEqual({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })
})
