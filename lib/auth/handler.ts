/**
 * LUM-1027 — the HTTP entry point of the auth provider's own API, mounted at
 * /api/auth/* (app/api/auth/[...all]). Better Auth serves sign-in, sign-up,
 * sign-out, OAuth callbacks, email verification and the session endpoint,
 * and authenticates each of those itself.
 */
export async function handleAuthRequest(request: Request): Promise<Response> {
  const { getBetterAuth } = await import('./better-auth/server')
  return getBetterAuth().handler(request)
}
