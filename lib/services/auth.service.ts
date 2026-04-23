import { createHash } from 'crypto'
import { clerkClient } from '@clerk/nextjs/server'
import { miscRepository } from '@/lib/repositories/misc.repository'

export interface VerifyApiKeyResult {
  user: { id: string; email: string; name: string }
  workspace: { id: string; slug: string; name: string }
  apiKey: { id: string; name: string; prefix: string }
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
   * Verify a CLI bearer token and resolve the caller's identity.
   *
   * Returns the identity payload, or `null` if the key is unknown or revoked.
   * On success, touches `lastUsedAt` in the background.
   */
  async verifyApiKey(token: string): Promise<VerifyApiKeyResult | null> {
    const keyHash = createHash('sha256').update(token).digest('hex')
    const apiKey = await miscRepository.findApiKeyByHashForVerify(keyHash)
    if (!apiKey || apiKey.revokedAt !== null) return null

    void miscRepository.touchApiKeyLastUsed(keyHash).catch(() => {})

    const client = await clerkClient()
    const clerkUser = await client.users.getUser(apiKey.member.clerkId)

    const email =
      clerkUser.emailAddresses.find(
        e => e.id === clerkUser.primaryEmailAddressId
      )?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      ''

    return {
      user: {
        id: apiKey.member.clerkId,
        email,
        name: resolveDisplayName(
          clerkUser.firstName,
          clerkUser.lastName,
          email
        ),
      },
      workspace: {
        id: apiKey.member.workspace.id,
        slug: apiKey.member.workspace.slug,
        name: apiKey.member.workspace.name,
      },
      apiKey: {
        id: apiKey.id,
        name: apiKey.label,
        prefix: apiKey.keyPrefix,
      },
    }
  },
}
