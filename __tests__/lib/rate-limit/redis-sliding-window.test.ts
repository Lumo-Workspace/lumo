/**
 * @jest-environment node
 *
 * LUM-1020 — standard Redis backend: sends the atomic sliding-window script
 * with a prefixed key and (now, window, max, unique member), maps the reply.
 */
import {
  createRedisSlidingWindow,
  REDIS_SLIDING_WINDOW_SCRIPT,
} from '@/lib/rate-limit/redis-sliding-window'

const OPTS = { prefix: 'sarif:rate', max: 30, windowMs: 60_000 }

function fakeClient(reply: unknown) {
  return { eval: jest.fn().mockResolvedValue(reply) }
}

describe('createRedisSlidingWindow', () => {
  it('evals the sliding-window script against <prefix>:<key>', async () => {
    const client = fakeClient([1, 29])
    const w = createRedisSlidingWindow(
      OPTS,
      async () => client,
      () => 5_000
    )
    await expect(w.limit('gh:pr:1')).resolves.toEqual({
      success: true,
      remaining: 29,
    })
    expect(client.eval).toHaveBeenCalledTimes(1)
    const [script, opts] = client.eval.mock.calls[0]
    expect(script).toBe(REDIS_SLIDING_WINDOW_SCRIPT)
    expect(opts.keys).toEqual(['sarif:rate:gh:pr:1'])
    expect(opts.arguments.slice(0, 3)).toEqual(['5000', '60000', '30'])
    expect(opts.arguments[3]).toMatch(/^5000:/)
  })

  it('uses a unique sorted-set member per hit (same-millisecond hits all count)', async () => {
    const client = fakeClient([1, 1])
    const w = createRedisSlidingWindow(
      OPTS,
      async () => client,
      () => 1
    )
    await w.limit('k')
    await w.limit('k')
    const members = client.eval.mock.calls.map(c => c[1].arguments[3])
    expect(new Set(members).size).toBe(2)
  })

  it('maps a refusal reply to success:false', async () => {
    const w = createRedisSlidingWindow(OPTS, async () => fakeClient([0, 0]))
    await expect(w.limit('k')).resolves.toEqual({
      success: false,
      remaining: 0,
    })
  })

  it('propagates client errors to the caller', async () => {
    const client = { eval: jest.fn().mockRejectedValue(new Error('offline')) }
    const w = createRedisSlidingWindow(OPTS, async () => client)
    await expect(w.limit('k')).rejects.toThrow('offline')
  })

  it('the script trims the window, checks max, then records + sets TTL', () => {
    const s = REDIS_SLIDING_WINDOW_SCRIPT
    const order = ['ZREMRANGEBYSCORE', 'ZCARD', 'ZADD', 'PEXPIRE'].map(cmd =>
      s.indexOf(cmd)
    )
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
