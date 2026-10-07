/**
 * Clerk implementation of the server-side session interface (LUM-1026).
 */
import { auth, currentUser } from '@clerk/nextjs/server'
import type { AuthUser } from '../types'

/** The signed-in user's id for the current request, or null. */
export async function getCurrentUserId(): Promise<string | null> {
  const { userId } = await auth()
  return userId
}

/** The signed-in user for the current request, or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return currentUser()
}
