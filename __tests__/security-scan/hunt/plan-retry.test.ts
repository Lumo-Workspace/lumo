import { isTransientPlanError } from '@/lib/security-scan/hunt/plan-retry'

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
