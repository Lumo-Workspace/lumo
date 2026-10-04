import { z } from 'zod'

/** Max lengths for the public waitlist signup (LUM-983). */
export const WAITLIST_FIELD_LIMITS = {
  /** RFC 5321 path limit. */
  email: 254,
  name: 100,
  company: 200,
  /** The form sends short buckets like `2-5` / `50+`. */
  teamSize: 20,
} as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Optional free-text field: trimmed, bounded, blank → null. */
function optionalText(max: number, label: string) {
  return z
    .string({ error: `${label} must be a string` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullish()
    .transform(v => (v ? v : null))
}

/**
 * Body for `POST /api/waitlist` (public, unauthenticated). The email is
 * trimmed and lower-cased before the format check, as the route always
 * normalised it before storing.
 */
export const waitlistSignupSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .toLowerCase()
    .min(1, 'Email is required')
    .max(
      WAITLIST_FIELD_LIMITS.email,
      `Email must be at most ${WAITLIST_FIELD_LIMITS.email} characters`
    )
    .regex(EMAIL_PATTERN, 'Invalid email address'),
  name: optionalText(WAITLIST_FIELD_LIMITS.name, 'Name'),
  company: optionalText(WAITLIST_FIELD_LIMITS.company, 'Company'),
  teamSize: optionalText(WAITLIST_FIELD_LIMITS.teamSize, 'Team size'),
})

export type WaitlistSignupBody = z.infer<typeof waitlistSignupSchema>
