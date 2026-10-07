/**
 * LUM-1027 — the HTTP entry point of the auth provider's own API, mounted at
 * /api/auth/* (app/api/auth/[...all]). Under Better Auth it serves sign-in,
 * sign-up, sign-out, OAuth callbacks, email verification and the session
 * endpoint; Better Auth authenticates each of those itself. Under Clerk the
 * provider runs elsewhere, so every path is a 404.
 */
import { isBetterAuth } from './provider'

export async function handleAuthRequest(request: Request): Promise<Response> {
  if (!isBetterAuth()) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const { getBetterAuth } = await import('./better-auth/server')
  return getBetterAuth().handler(request)
}
