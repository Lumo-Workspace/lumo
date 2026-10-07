/**
 * User directory entry point (LUM-1026): server-side user lookups and
 * profile writes, from whichever provider AUTH_PROVIDER selects — Clerk's
 * Backend API, or Better Auth's `auth_users` table (LUM-1027, loaded lazily).
 */
import * as clerk from './clerk/users'
import { isBetterAuth } from './provider'
import type { UserDirectory } from './types'

/** The directory for the current request (routes, server components). */
export async function getUserDirectory(): Promise<UserDirectory> {
  if (isBetterAuth()) {
    return (await import('./better-auth/users')).getUserDirectory()
  }
  return clerk.getUserDirectory()
}

/** A directory for code that runs outside a request (handlers, jobs). */
export async function createUserDirectory(): Promise<UserDirectory> {
  if (isBetterAuth()) {
    return (await import('./better-auth/users')).createUserDirectory()
  }
  return clerk.createUserDirectory()
}

/** Whether `createUserDirectory()` has the credentials it needs. */
export function isUserDirectoryConfigured(): boolean {
  // Better Auth's directory is the app's own database: always available.
  return isBetterAuth() || clerk.isUserDirectoryConfigured()
}

export type {
  AuthEmailAddress,
  AuthUser,
  UserDirectory,
  UserListQuery,
  UserNameUpdate,
} from './types'
