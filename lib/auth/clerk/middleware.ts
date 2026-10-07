/**
 * Clerk implementation of the request middleware (LUM-1026), used by
 * proxy.ts. The handler sees only the provider-neutral `MiddlewareAuth`.
 */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import type { AuthMiddlewareHandler, MiddlewareAuth } from '../types'

/** `(request) => boolean` for a list of path patterns like `/api/(.*)`. */
export { createRouteMatcher }

/**
 * Wrap a middleware handler so it runs with the auth session resolved.
 * `auth.protect()` keeps the provider's own behavior (an anonymous page
 * request is redirected to sign-in).
 */
export function createAuthMiddleware(handler: AuthMiddlewareHandler) {
  return clerkMiddleware(async (clerkAuth, request) => {
    const auth: MiddlewareAuth = {
      userId: async () => (await clerkAuth()).userId,
      protect: async () => {
        await clerkAuth.protect()
      },
    }
    return handler(auth, request)
  })
}
