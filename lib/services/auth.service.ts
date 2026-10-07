import { createHash } from 'crypto'
import { getUserDirectory } from '@/lib/auth/users'
import { miscRepository } from '@/lib/repositories/misc.repository'

/**
 * Minimal identity produced by `verifyApiKey` — contains only what the DB
 * knows. `user.id` is the Clerk user ID. Callers that need human-readable
 * email/name should additionally call `fetchUserProfile`.
 */
export interface VerifyApiKeyResult {
  user: { id: string }
  workspace: { id: string; slug: string; name: string }
  apiKey: { id: string; name: string; prefix: string; scope?: string | null }
}

/** LUM-735: the only scope today — a key that may ONLY push SARIF reports. */
export const SECURITY_INGEST_SCOPE = 'security:ingest'
export const API_KEY_SCOPES = [SECURITY_INGEST_SCOPE] as const

/** Human profile from Clerk — display-only. */
export interface UserProfile {
  email: string
  name: string
}

function resolveDisplayName(
  firstName: string | null,
  lastName: string | null,
  email: string
): string {
  const full = [firstName, lastName].filter(Boolean).join(' ').trim()
  if (full) return full
  const emailLocal = email.split('@')[0]
  return emailLocal ?? ''
}

export const authService = {
  /**
   * Verify a Lumo CLI bearer token.
   *
   * Pure DB lookup — no Clerk call, no profile enrichment. Returns the
   * minimal identity needed to authorize a request (clerkId + workspace
   * + apiKey), or `null` if the key is unknown or revoked, or its member
   * has been deactivated. On success,
   * touches `lastUsedAt` in the background.
   *
   * For display purposes (email/name), call `fetchUserProfile(user.id)`
   * after verification.
   */
  async verifyApiKey(token: string): Promise<VerifyApiKeyResult | null> {
    const keyHash = createHash('sha256').update(token).digest('hex')
    const apiKey = await miscRepository.findApiKeyByHashForVerify(keyHash)
    if (!apiKey || apiKey.revokedAt !== null) return null
    // LUM-906: deactivation revokes the member's keys; refusing keys of a
    // deactivated member here too is the second line of defence.
    if (apiKey.member.deactivatedAt) return null

    void miscRepository.touchApiKeyLastUsed(keyHash).catch(() => {})

    return {
      user: { id: apiKey.member.clerkId },
      workspace: {
        id: apiKey.member.workspace.id,
        slug: apiKey.member.workspace.slug,
        name: apiKey.member.workspace.name,
      },
      apiKey: {
        id: apiKey.id,
        name: apiKey.label,
        prefix: apiKey.keyPrefix,
        scope: apiKey.scope ?? null,
      },
    }
  },

  /**
   * Fetch the Clerk profile (email + display name) for a given clerkId.
   *
   * Network call to Clerk (~100-300ms). Only use when the email/name are
   * actually needed — e.g. the CLI `whoami` "logged in as X" line. The
   * hook, MCP, and other machine-only paths should skip this.
   */
  async fetchUserProfile(clerkId: string): Promise<UserProfile> {
    const client = await getUserDirectory()
    const clerkUser = await client.getUser(clerkId)

    const email =
      clerkUser.emailAddresses.find(
        e => e.id === clerkUser.primaryEmailAddressId
      )?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      ''

    return {
      email,
      name: resolveDisplayName(clerkUser.firstName, clerkUser.lastName, email),
    }
  },
}
