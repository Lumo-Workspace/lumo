/**
 * Display profiles (name, email, avatar) of users by id, read through the
 * user directory. Moved from lib/utils/clerk-helpers (LUM-1077).
 */
import { logger } from '@/lib/logger'
import { listUsersByIds } from './user-batch'
import { getUserDirectory } from './users'

export interface CachedUser {
  name: string
  email: string
}

interface CacheEntry {
  user: CachedUser
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry>()

/** Exposed for testing only */
export function _clearCache(): void {
  cache.clear()
}

/**
 * Look up a user's display name and primary email.
 * Results are cached in-memory for 5 minutes.
 */
export async function getCachedUser(clerkId: string): Promise<CachedUser> {
  const now = Date.now()
  const cached = cache.get(clerkId)
  if (cached && cached.expiresAt > now) {
    return cached.user
  }

  try {
    const client = await getUserDirectory()
    const authUser = await client.getUser(clerkId)

    const firstName = authUser.firstName ?? ''
    const lastName = authUser.lastName ?? ''
    const fullName = `${firstName} ${lastName}`.trim()

    const user: CachedUser = {
      name: fullName || authUser.username || 'Unknown',
      email: authUser.primaryEmailAddress?.emailAddress ?? '',
    }

    cache.set(clerkId, { user, expiresAt: now + CACHE_TTL_MS })
    return user
  } catch (err) {
    logger.error('[user-profiles] Failed to fetch user', {
      userId: clerkId,
      error: (err as Error)?.message ?? String(err),
    })
    return { name: 'Unknown', email: '' }
  }
}

export interface EnrichedUser {
  clerkId: string
  name: string
  imageUrl: string
}

export async function enrichUsers(
  clerkIds: string[]
): Promise<Map<string, EnrichedUser>> {
  if (clerkIds.length === 0) return new Map()
  const client = await getUserDirectory()
  const users = await listUsersByIds(client, clerkIds)
  const map = new Map<string, EnrichedUser>()
  for (const u of users) {
    map.set(u.id, {
      clerkId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown',
      imageUrl: u.imageUrl,
    })
  }
  return map
}

export interface UserProfile {
  name: string | null
  email: string | null
}

/**
 * LUM-858: name + primary email for many users, paged by `listUsersByIds`
 * (LUM-1105). Users the directory no longer knows are simply absent.
 */
export async function lookupUserProfiles(
  clerkIds: readonly string[]
): Promise<Map<string, UserProfile>> {
  const out = new Map<string, UserProfile>()
  if (clerkIds.length === 0) return out
  const client = await getUserDirectory()
  for (const u of await listUsersByIds(client, clerkIds)) {
    const email =
      u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)
        ?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      null
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
    out.set(u.id, { name: name || null, email })
  }
  return out
}
