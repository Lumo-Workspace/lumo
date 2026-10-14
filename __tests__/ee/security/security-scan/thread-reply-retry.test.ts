/**
 * LUM-1139 — the thread-reply classifier gets exactly one retry on a refusal
 * or a failed call (timeout included), inside a bounded total time.
 */
import {
  CLASSIFY_ATTEMPT_TIMEOUT_MS,
  CLASSIFY_TOTAL_BUDGET_MS,
  classifyWithRetry,
} from '@/ee/security/security-scan/thread-reply-retry'

const YES = {
  isLearning: true,
  learning: 'x is intentional because y.',
  pathGlob: null,
}
const NO = { isLearning: false, learning: '', pathGlob: null }
const timeout = () =>
  Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  })

describe('classifyWithRetry', () => {
  it('a learning on the first call is not retried', async () => {
    const classify = jest.fn().mockResolvedValue(YES)
    await expect(classifyWithRetry(classify)).resolves.toEqual({
      verdict: YES,
      attempts: 1,
      retried: null,
      errors: [],
    })
    expect(classify).toHaveBeenCalledTimes(1)
    expect(classify).toHaveBeenCalledWith(CLASSIFY_ATTEMPT_TIMEOUT_MS, 1)
  })

  it('a refusal is retried exactly once — and the retry answer is used', async () => {
    const classify = jest
      .fn()
      .mockResolvedValueOnce(NO)
      .mockResolvedValueOnce(YES)
    const r = await classifyWithRetry(classify)
    expect(classify).toHaveBeenCalledTimes(2)
    expect(classify.mock.calls.map(c => c[1])).toEqual([1, 2])
    expect(r).toEqual({
      verdict: YES,
      attempts: 2,
      retried: 'refused',
      errors: [],
    })
  })

  it('two refusals stay a refusal (never a third call)', async () => {
    const classify = jest.fn().mockResolvedValue(NO)
    const r = await classifyWithRetry(classify)
    expect(classify).toHaveBeenCalledTimes(2)
    expect(r.verdict).toEqual(NO)
    expect(r.retried).toBe('refused')
  })

  it('a timeout is retried, with the time left', async () => {
    let t = 0
    const classify = jest
      .fn()
      .mockImplementationOnce(async () => {
        t += CLASSIFY_ATTEMPT_TIMEOUT_MS
        throw timeout()
      })
      .mockResolvedValueOnce(YES)
    const r = await classifyWithRetry(classify, { now: () => t })
    expect(r).toEqual({
      verdict: YES,
      attempts: 2,
      retried: 'error',
      errors: ['The operation was aborted due to timeout'],
    })
    expect(classify.mock.calls[1][0]).toBe(
      CLASSIFY_TOTAL_BUDGET_MS - CLASSIFY_ATTEMPT_TIMEOUT_MS
    )
  })

  it('both calls fail → no verdict, both errors reported, never throws', async () => {
    const classify = jest
      .fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(new Error('gateway down'))
    const r = await classifyWithRetry(classify)
    expect(r.verdict).toBeNull()
    expect(r.attempts).toBe(2)
    expect(r.errors).toEqual([
      'The operation was aborted due to timeout',
      'gateway down',
    ])
  })

  it('a refusal then a failure keeps the refusal', async () => {
    const classify = jest
      .fn()
      .mockResolvedValueOnce(NO)
      .mockRejectedValueOnce(new Error('gateway down'))
    const r = await classifyWithRetry(classify)
    expect(r.verdict).toEqual(NO)
    expect(r.errors).toEqual(['gateway down'])
  })

  it('no retry when too little of the budget is left', async () => {
    let t = 0
    const classify = jest.fn().mockImplementation(async () => {
      t += 52_000
      throw timeout()
    })
    const r = await classifyWithRetry(classify, { now: () => t })
    expect(classify).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ verdict: null, attempts: 1, retried: null })
  })

  it('every call fits the total budget', async () => {
    let t = 0
    const timeouts: number[] = []
    const classify = jest.fn().mockImplementation(async (ms: number) => {
      timeouts.push(ms)
      t += ms
      throw timeout()
    })
    await classifyWithRetry(classify, { now: () => t })
    expect(timeouts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
      CLASSIFY_TOTAL_BUDGET_MS
    )
  })
})
