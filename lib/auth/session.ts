/**
 * Server-side session entry point (LUM-1026 / LUM-1027): the signed-in user
 * of the current request. The Better Auth implementation is imported lazily
 * so a module that merely imports this one (and every test that mocks it)
 * never loads the Better Auth server instance.
 */
import type { AuthUser } from './types'

/** The signed-in user's id for the current request, or null. */
export async function getCurrentUserId(): Promise<string | null> {
  return (await import('./better-auth/session')).getCurrentUserId()
}

/** The signed-in user for the current request, or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return (await import('./better-auth/session')).getCurrentUser()
}
