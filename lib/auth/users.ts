/**
 * User directory entry point (LUM-1026): server-side user lookups and
 * profile writes, backed by Better Auth's `auth_users` table (LUM-1027,
 * loaded lazily).
 */
import type { UserDirectory } from './types'

/** The directory for the current request (routes, server components). */
export async function getUserDirectory(): Promise<UserDirectory> {
  return (await import('./better-auth/users')).getUserDirectory()
}

/** A directory for code that runs outside a request (handlers, jobs). */
export async function createUserDirectory(): Promise<UserDirectory> {
  return (await import('./better-auth/users')).createUserDirectory()
}

/**
 * Whether `createUserDirectory()` has what it needs. Always: the directory is
 * the app's own database.
 */
export function isUserDirectoryConfigured(): boolean {
  return true
}

/**
 * Better Auth's name columns for a new user (pure, no SDK). Exposed for the
 * Clerk → Better Auth import (LUM-1072), which writes `auth_users` rows
 * itself and must name them exactly as a Better Auth sign-up would.
 */
export { nameFieldsForCreate } from './better-auth/user-shape'

export type {
  AuthEmailAddress,
  AuthUser,
  UserDirectory,
  UserListQuery,
  UserNameUpdate,
} from './types'
