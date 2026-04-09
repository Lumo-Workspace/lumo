import { clerkClient } from '@clerk/nextjs/server'

export interface CachedClerkUser {
  name: string
  email: string
}

interface CacheEntry {
  user: CachedClerkUser
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry>()

/** Exposed for testing only */
export function _clearCache(): void {
  cache.clear()
}

/**
 * Look up a Clerk user's display name and primary email.
 * Results are cached in-memory for 5 minutes.
 */
export async function getClerkUser(clerkId: string): Promise<CachedClerkUser> {
  const now = Date.now()
  const cached = cache.get(clerkId)
  if (cached && cached.expiresAt > now) {
    return cached.user
  }

  try {
    const client = await clerkClient()
    const clerkUser = await client.users.getUser(clerkId)

    const firstName = clerkUser.firstName ?? ''
    const lastName = clerkUser.lastName ?? ''
    const fullName = `${firstName} ${lastName}`.trim()

    const user: CachedClerkUser = {
      name: fullName || clerkUser.username || 'Unknown',
      email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
    }

    cache.set(clerkId, { user, expiresAt: now + CACHE_TTL_MS })
    return user
  } catch (err) {
    console.error(`[clerk-cache] Failed to fetch user ${clerkId}:`, err)
    return { name: 'Unknown', email: '' }
  }
}

export interface EnrichedUser {
  clerkId: string
  name: string
  imageUrl: string
}

export async function enrichClerkUsers(
  clerkIds: string[]
): Promise<Map<string, EnrichedUser>> {
  if (clerkIds.length === 0) return new Map()
  const client = await clerkClient()
  const users = await client.users.getUserList({
    userId: clerkIds,
    limit: clerkIds.length,
  })
  const map = new Map<string, EnrichedUser>()
  for (const u of users.data) {
    map.set(u.id, {
      clerkId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown',
      imageUrl: u.imageUrl,
    })
  }
  return map
}
