import { createSlidingWindowRateLimiter } from '@/lib/services/sliding-window-rate-limit'

/**
 * Per-client-IP throttle for the public `POST /api/waitlist` signup
 * (LUM-983). 5 requests per IP per rolling minute: a real visitor submitting
 * the form once or twice (or retrying after a typo) never gets near it, while
 * a script loses its ability to flood `waitlist_entries` from one address.
 * Like every limiter built on the shared helper, it fails open when the
 * limiter backend errors — signup must not go down with Redis.
 */
export const WAITLIST_SIGNUP_RATE_LIMIT = { max: 5, windowMs: 60_000 }

export const WAITLIST_RATE_LIMITED_MESSAGE =
  'Too many signup attempts. Please try again in a minute.'

const limiter = createSlidingWindowRateLimiter({
  prefix: 'waitlist:rate',
  max: WAITLIST_SIGNUP_RATE_LIMIT.max,
  windowMs: WAITLIST_SIGNUP_RATE_LIMIT.windowMs,
  logTag: 'waitlist-rate-limit',
})

/** Throws `{ status: 429 }` when `clientIp` is over the signup limit. */
export async function checkWaitlistSignupRateLimit(
  clientIp: string
): Promise<void> {
  const allowed = await limiter.check(clientIp)
  if (!allowed) {
    throw Object.assign(new Error(WAITLIST_RATE_LIMITED_MESSAGE), {
      status: 429,
    })
  }
}

/** Test-only: reset module-level state between test cases. */
export function __resetWaitlistRateLimiterForTests(): void {
  limiter.reset()
}
