import { listUsersByIds } from '@/lib/auth/user-batch'
import { getUserDirectory } from '@/lib/auth/users'

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
    const client = await getUserDirectory()
    const clerkUser = await client.getUser(clerkId)

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

export interface ClerkProfile {
  name: string | null
  email: string | null
}

/**
 * LUM-858: name + primary email for many Clerk users, paged by
 * `listUsersByIds` (LUM-1105). Users Clerk no longer knows are simply absent.
 */
export async function lookupClerkProfiles(
  clerkIds: readonly string[]
): Promise<Map<string, ClerkProfile>> {
  const out = new Map<string, ClerkProfile>()
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
