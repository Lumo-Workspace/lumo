/**
 * Server-side session entry point (LUM-1026 / LUM-1027): the signed-in user
 * of the current request, from whichever provider AUTH_PROVIDER selects. The
 * Better Auth implementation is imported lazily so a Clerk deployment (and
 * every Clerk-mocked test) never loads it.
 */
import * as clerk from './clerk/session'
import { isBetterAuth } from './provider'
import type { AuthUser } from './types'

/** The signed-in user's id for the current request, or null. */
export async function getCurrentUserId(): Promise<string | null> {
  if (isBetterAuth()) {
    return (await import('./better-auth/session')).getCurrentUserId()
  }
  return clerk.getCurrentUserId()
}

/** The signed-in user for the current request, or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isBetterAuth()) {
    return (await import('./better-auth/session')).getCurrentUser()
  }
  return clerk.getCurrentUser()
}
