import {
  isTransientPlanError,
  describePlanFailure,
  PLAN_FAILURE_TEXT_CHARS,
} from '@/lib/security-scan/hunt/plan-retry'

// LUM-758 follow-up. `planHunt` never throws, so `planHuntStep`'s platform
// retry can never fire — this predicate is the ONLY thing deciding whether a
// failed plan gets a second window or degrades to the deterministic fallback
// for the rest of the scan. Its whole value is that it says no to the
// deterministic failures.
describe('isTransientPlanError', () => {
  const abort = (name: string) => Object.assign(new Error('x'), { name })

  it('retries the gateway shapes that cost prod a whole plan', () => {
    // PR #969's actual failure: the abort signal landed inside the SDK's
    // backoff sleep rather than inside a request.
    expect(isTransientPlanError(new Error('Delay was aborted'))).toBe(true)
    expect(isTransientPlanError(abort('AbortError'))).toBe(true)
    expect(isTransientPlanError(abort('TimeoutError'))).toBe(true)
    expect(isTransientPlanError(new Error('The operation timed out'))).toBe(
      true
    )
    expect(isTransientPlanError(new Error('fetch failed'))).toBe(true)
    expect(isTransientPlanError(new Error('socket hang up'))).toBe(true)
    expect(isTransientPlanError(new Error('read ECONNRESET'))).toBe(true)
    expect(isTransientPlanError(new Error('Gateway returned 503'))).toBe(true)
  })

  it('does NOT retry a model that got the shape wrong', () => {
    // Retrying these burns the budget twice for the same answer.
    expect(
      isTransientPlanError(
        new Error('AI_NoObjectGeneratedError: no object generated')
      )
    ).toBe(false)
    expect(
      isTransientPlanError(new Error('response did not match schema'))
    ).toBe(false)
    expect(isTransientPlanError(new Error('validation failed'))).toBe(false)
  })

  it('a shape failure stays a shape failure even when the message also mentions a transport word', () => {
    // This is what the early shape checks are FOR. Without them the transient
    // word later in the message wins and we pay for the same wrong shape twice.
    expect(
      isTransientPlanError(
        new Error(
          'AI_NoObjectGeneratedError: no object generated after timeout'
        )
      )
    ).toBe(false)
    expect(
      isTransientPlanError(new Error('response did not match schema; aborted'))
    ).toBe(false)
  })

  it('does not treat an unrecognised failure as transient', () => {
    // Fail towards the deterministic fallback, which is a real answer.
    expect(isTransientPlanError(new Error('something else entirely'))).toBe(
      false
    )
    expect(isTransientPlanError(null)).toBe(false)
  })

  it('is not fooled by a 4xx that merely contains digits', () => {
    expect(isTransientPlanError(new Error('400 bad request'))).toBe(false)
  })
})

/**
 * LUM-766 follow-up. Two production failures on the same day, one message
 * prefix, opposite correct responses — and the evidence that tells them apart
 * was being discarded.
 */
describe('LUM-766 follow-up — a budget miss is not a shape miss', () => {
  /** What the AI SDK's NoObjectGeneratedError actually carries. */
  const noObject = (over: Record<string, unknown>) =>
    Object.assign(
      new Error('No object generated: the model did not return a response.'),
      over
    )

  it('retries a call that ran out of output budget', () => {
    // `length` means THIS attempt hit the ceiling. LUM-766's isolation
    // experiment measured reasoning appetite as heavy-tailed — the same prompt
    // spending 1938 tokens on one run and 3912 on the next — so the second
    // window it was already configured to have is worth spending.
    expect(
      isTransientPlanError(
        noObject({
          finishReason: 'length',
          usage: { outputTokens: 8_000, outputTokenDetails: { reasoningTokens: 7_940 } },
        })
      )
    ).toBe(true)
  })

  it('retries a call that returned nothing at all', () => {
    // Same shape reported without a finish reason. A validation miss always
    // carries the text it failed to validate; this carries none.
    expect(isTransientPlanError(noObject({ text: '' }))).toBe(true)
    expect(isTransientPlanError(noObject({}))).toBe(true)
  })

  it('retries a schema miss that is really a truncation', () => {
    // The most realistic shape of all, and the one the old rule got most
    // wrong: the output budget runs out mid-JSON, so the SDK reports a schema
    // mismatch — but the model was not wrong about the shape, it was cut off
    // writing it. `finishReason` is the only thing that tells those apart, and
    // it must be consulted BEFORE the message is.
    expect(
      isTransientPlanError(
        Object.assign(
          new Error('No object generated: response did not match schema.'),
          {
            finishReason: 'length',
            text: '{"tasks":[{"objective":"trace the id from',
            usage: {
              outputTokens: 8_000,
              outputTokenDetails: { reasoningTokens: 7_100 },
            },
          }
        )
      )
    ).toBe(true)
  })

  it('still refuses to retry a genuine schema miss', () => {
    // The model was wrong about the shape and will be wrong the same way again.
    // This is the case the old blanket rule was right about, and the one the
    // new rule must not swallow.
    expect(
      isTransientPlanError(
        Object.assign(
          new Error('No object generated: response did not match schema.'),
          {
            finishReason: 'stop',
            text: '{"tasks":[]}',
          }
        )
      )
    ).toBe(false)
  })

  it('does not retry a schema miss just because its text is empty-ish', () => {
    // "did not return a response" is the discriminator, not "no text".
    expect(
      isTransientPlanError(
        Object.assign(
          new Error('No object generated: response did not match schema.'),
          { text: '' }
        )
      )
    ).toBe(false)
  })
})

describe('LUM-766 follow-up — what a failed plan records', () => {
  it('keeps the finish reason, the reasoning spend and the raw output', () => {
    const facts = describePlanFailure(
      Object.assign(new Error('No object generated: response did not match schema.'), {
        finishReason: 'stop',
        text: '{"tasks":[]}',
        usage: { outputTokens: 120, outputTokenDetails: { reasoningTokens: 60 } },
      })
    )
    expect(facts).toEqual({
      message: 'No object generated: response did not match schema.',
      finishReason: 'stop',
      reasoningTokens: 60,
      outputTokens: 120,
      // The raw output is what says WHICH field missed — here, `reason`.
      textPrefix: '{"tasks":[]}',
    })
  })

  it('distinguishes "emitted nothing" from "emitted something unparseable"', () => {
    expect(describePlanFailure(Object.assign(new Error('x'), { text: '' })).textPrefix).toBe('')
    expect(describePlanFailure(new Error('x')).textPrefix).toBeUndefined()
  })

  it('clips the raw output rather than carrying a whole response into the audit', () => {
    const facts = describePlanFailure(
      Object.assign(new Error('x'), { text: 'a'.repeat(PLAN_FAILURE_TEXT_CHARS + 500) })
    )
    expect(facts.textPrefix).toHaveLength(PLAN_FAILURE_TEXT_CHARS)
  })

  it('survives an error carrying none of it', () => {
    expect(describePlanFailure('boom')).toEqual({ message: 'boom' })
  })
})
