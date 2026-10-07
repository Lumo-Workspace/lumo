/**
 * @jest-environment node
 *
 * LUM-1020 — in-process sliding-window fallback: limit, rolling (not fixed)
 * window, per-key isolation, remaining count, key cap eviction, reset.
 */
import {
  createMemorySlidingWindow,
  MEMORY_MAX_KEYS,
} from '@/lib/rate-limit/memory-sliding-window'

function clock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance(ms: number) {
      t += ms
    },
  }
}

const OPTS = { prefix: 'test:rate', max: 3, windowMs: 10_000 }

describe('createMemorySlidingWindow', () => {
  it('allows max hits per key with a decreasing remaining, then refuses', async () => {
    const c = clock()
    const w = createMemorySlidingWindow(OPTS, c.now)
    await expect(w.limit('k')).resolves.toEqual({ success: true, remaining: 2 })
    await expect(w.limit('k')).resolves.toEqual({ success: true, remaining: 1 })
    await expect(w.limit('k')).resolves.toEqual({ success: true, remaining: 0 })
    await expect(w.limit('k')).resolves.toEqual({
      success: false,
      remaining: 0,
    })
    await expect(w.limit('other')).resolves.toMatchObject({ success: true })
  })

  it('is a sliding window: each hit expires windowMs after it was made', async () => {
    const c = clock()
    const w = createMemorySlidingWindow(OPTS, c.now)
    await w.limit('k') // t0
    c.advance(4_000)
    await w.limit('k') // t0+4s
    await w.limit('k') // t0+4s
    await expect(w.limit('k')).resolves.toMatchObject({ success: false })

    // Just past t0+10s: only the first hit has aged out → exactly one slot.
    c.advance(6_001)
    await expect(w.limit('k')).resolves.toMatchObject({ success: true })
    await expect(w.limit('k')).resolves.toMatchObject({ success: false })

    // Past t0+14s: the two t0+4s hits have aged out too.
    c.advance(4_000)
    await expect(w.limit('k')).resolves.toMatchObject({
      success: true,
      remaining: 1,
    })
  })

  it('refused hits do not extend the window', async () => {
    const c = clock()
    const w = createMemorySlidingWindow(OPTS, c.now)
    for (let i = 0; i < 3; i++) await w.limit('k')
    for (let i = 0; i < 5; i++) {
      c.advance(1_000)
      await expect(w.limit('k')).resolves.toMatchObject({ success: false })
    }
    c.advance(5_001) // t0 + 10_001
    await expect(w.limit('k')).resolves.toMatchObject({ success: true })
  })

  it('evicts the least recently used key beyond MEMORY_MAX_KEYS', async () => {
    const c = clock()
    const w = createMemorySlidingWindow({ ...OPTS, max: 1 }, c.now)
    await w.limit('first')
    await expect(w.limit('first')).resolves.toMatchObject({ success: false })
    for (let i = 0; i < MEMORY_MAX_KEYS; i++) await w.limit(`fill-${i}`)
    // 'first' was evicted, so its history is gone.
    await expect(w.limit('first')).resolves.toMatchObject({ success: true })
  })

  it('reset() clears every key', async () => {
    const w = createMemorySlidingWindow(OPTS)
    for (let i = 0; i < 3; i++) await w.limit('k')
    await expect(w.limit('k')).resolves.toMatchObject({ success: false })
    w.reset()
    await expect(w.limit('k')).resolves.toMatchObject({ success: true })
  })
})
