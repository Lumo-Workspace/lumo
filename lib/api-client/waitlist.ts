import { ApiClientError } from './base'

export interface WaitlistSignupInput {
  email: string
  name: string
  company: string
  teamSize: string
}

export interface WaitlistSignupResult {
  /** 'created' = new entry, 'existing' = email already on the list */
  result: 'created' | 'existing'
  message: string
}

export const waitlistClient = {
  /**
   * Join the waitlist. The route distinguishes new entries (HTTP 201) from
   * already-registered emails (HTTP 200) with the same JSON shape; we collapse
   * that into a discriminated `result` field so callers don't have to look at
   * status codes directly.
   */
  async join(input: WaitlistSignupInput): Promise<WaitlistSignupResult> {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    let data: { message?: string; error?: string } = {}
    try {
      data = await res.json()
    } catch {
      // Empty / non-JSON body — fall through to default error handling.
    }

    if (res.status === 201) {
      return { result: 'created', message: data.message ?? '' }
    }
    if (res.status === 200) {
      return { result: 'existing', message: data.message ?? '' }
    }

    throw new ApiClientError(
      data.error ?? `Request failed with status ${res.status}`,
      res.status
    )
  },
}
