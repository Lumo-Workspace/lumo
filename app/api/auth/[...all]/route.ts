// Better Auth's API (LUM-1027): sign-in / sign-up / sign-out, OAuth
// callbacks, email verification, session. 404 unless AUTH_PROVIDER=better-auth.
// The static sibling /api/auth/verify (CLI API-key check) takes precedence.
import { handleAuthRequest } from '@/lib/auth/handler'

export async function GET(request: Request) {
  return handleAuthRequest(request)
}

export async function POST(request: Request) {
  return handleAuthRequest(request)
}
