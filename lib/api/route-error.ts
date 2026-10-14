import { NextResponse } from 'next/server'

/** Map a service error carrying `status` to JSON; 500s never leak their message. */
export function errorResponse(error: unknown): NextResponse {
  const maybe = (error as { status?: unknown } | null)?.status
  const status = typeof maybe === 'number' ? maybe : 500
  const message =
    status === 500 || !(error instanceof Error)
      ? 'Internal error'
      : error.message
  return NextResponse.json({ error: message }, { status })
}
