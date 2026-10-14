/**
 * LUM-1084 — `isModelUnavailableError` tells "the hunt model is gone" apart
 * from a transient failure, so the hunt stops instead of retrying.
 */
import { isModelUnavailableError } from '@/ee/security/security-scan/hunt/model-unavailable'

describe('isModelUnavailableError', () => {
  it('matches the upstream text production saw', () => {
    expect(isModelUnavailableError(new Error('Model not exist.'))).toBe(true)
  })

  it("matches the gateway's own model_not_found error, by name, type or text", () => {
    expect(
      isModelUnavailableError(
        Object.assign(new Error('x'), { name: 'GatewayModelNotFoundError' })
      )
    ).toBe(true)
    expect(
      isModelUnavailableError(
        Object.assign(new Error('x'), { type: 'model_not_found' })
      )
    ).toBe(true)
    expect(
      isModelUnavailableError(
        new Error("The model 'alibaba/qwen3-coder-plus' does not exist")
      )
    ).toBe(true)
  })

  it('looks through the wrappers the AI SDK adds', () => {
    const inner = new Error('Model not exist.')
    expect(
      isModelUnavailableError(
        Object.assign(new Error('Failed after 2 attempts.'), {
          name: 'AI_RetryError',
          lastError: inner,
          errors: [new Error('gateway 500'), inner],
        })
      )
    ).toBe(true)
    expect(
      isModelUnavailableError(
        Object.assign(new Error('call failed'), { cause: inner })
      )
    ).toBe(true)
  })

  it('does not match transient or unrelated failures', () => {
    for (const e of [
      new Error('gateway 500'),
      new Error('Rate limit exceeded'),
      new Error('Delay was aborted'),
      new Error('no_providers_available'),
      new Error('the model read a file that does not exist'),
      new Error('ENOENT: no such file or directory'),
      null,
      undefined,
      42,
    ])
      expect(isModelUnavailableError(e)).toBe(false)
  })

  it('stops on a self-referencing cause chain', () => {
    const e = new Error('loop') as Error & { cause?: unknown }
    e.cause = e
    expect(isModelUnavailableError(e)).toBe(false)
  })
})
