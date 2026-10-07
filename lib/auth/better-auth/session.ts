/**
 * LUM-1027 — Better Auth implementation of the server-side session interface.
 */
import { headers } from 'next/headers'
import { authUserRepository } from '@/lib/repositories/auth-user.repository'
import type { AuthUser } from '../types'
import { getBetterAuth } from './server'
import { toAuthUser } from './user-shape'

/** The signed-in user's id for the current request, or null. */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getBetterAuth().api.getSession({
    headers: await headers(),
  })
  return session?.user.id ?? null
}

/**
 * The signed-in user for the current request, or null. Read from the
 * database (not the session cookie cache) so a just-verified email or a
 * profile edit is reflected at once.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const userId = await getCurrentUserId()
  if (!userId) return null
  const record = await authUserRepository.findById(userId)
  return record ? toAuthUser(record) : null
}
