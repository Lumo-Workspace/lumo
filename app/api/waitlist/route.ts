import { NextResponse } from 'next/server'

import { zodError } from '@/lib/api/helpers'
import { getClientIp } from '@/lib/api/client-ip'
import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  WAITLIST_SIGNUP_RATE_LIMIT,
  checkWaitlistSignupRateLimit,
} from '@/lib/services/waitlist-rate-limit'
import { waitlistSignupSchema } from '@/lib/validation/waitlist'

/**
 * POST /api/waitlist — intentionally public (marketing-site signup), so it
 * carries its own abuse controls (LUM-983): a per-client-IP rate limit,
 * checked before the body is read so invalid payloads count too, and a
 * bounded Zod schema.
 */
export async function POST(request: Request) {
  try {
    try {
      await checkWaitlistSignupRateLimit(getClientIp(request.headers))
    } catch (err) {
      if (err instanceof Error && 'status' in err && err.status === 429) {
        return NextResponse.json(
          { error: err.message },
          {
            status: 429,
            headers: {
              'Retry-After': String(WAITLIST_SIGNUP_RATE_LIMIT.windowMs / 1000),
            },
          }
        )
      }
      throw err
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = waitlistSignupSchema.safeParse(body ?? {})
    if (!parsed.success) return zodError(parsed)
    const { email, name, company, teamSize } = parsed.data

    // Check if already on waitlist
    const existing = await miscRepository.findWaitlistEntryByEmail(email)

    if (existing) {
      return NextResponse.json(
        { message: 'You are already on the waitlist!' },
        { status: 200 }
      )
    }

    await miscRepository.createWaitlistEntry({ email, name, company, teamSize })

    return NextResponse.json(
      { message: 'You have been added to the waitlist!' },
      { status: 201 }
    )
  } catch (error) {
    // eslint-disable-next-line no-console -- server-side error logging
    console.error('Waitlist signup error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
