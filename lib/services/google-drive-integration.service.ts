import { encrypt, decrypt } from '@/lib/crypto'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import { googleDriveIntegrationRepository } from '@/lib/repositories/google-drive-integration.repository'
import {
  exchangeCode,
  GOOGLE_DRIVE_OAUTH_SCOPES,
} from '@/lib/integrations/google-drive/oauth'
import {
  createGoogleDriveClient,
  GoogleNeedsReauthError,
  type GoogleDriveClient,
} from '@/lib/integrations/google-drive/client'
import type { GoogleUserInfo } from '@/lib/integrations/google-drive/types'

export interface OauthStatePayload {
  workspaceId: string
  memberId: string
  workspaceUrl: string
}

interface OauthStateEnvelope extends OauthStatePayload {
  iat: number
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export function encodeOauthState(payload: OauthStatePayload): string {
  const envelope: OauthStateEnvelope = { ...payload, iat: Date.now() }
  return encrypt(JSON.stringify(envelope))
}

export function decodeOauthState(state: string): OauthStatePayload | null {
  try {
    const parsed = JSON.parse(decrypt(state)) as OauthStateEnvelope
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.memberId !== 'string' ||
      typeof parsed.workspaceUrl !== 'string' ||
      typeof parsed.iat !== 'number'
    ) {
      return null
    }
    if (Date.now() - parsed.iat > OAUTH_STATE_TTL_MS) return null
    return {
      workspaceId: parsed.workspaceId,
      memberId: parsed.memberId,
      workspaceUrl: parsed.workspaceUrl,
    }
  } catch {
    return null
  }
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`)
  return (await res.json()) as GoogleUserInfo
}

export async function completeOauthFlow(
  input: {
    workspaceId: string
    memberId: string
    code: string
  },
  audit?: AuditContext
): Promise<void> {
  const tokens = await exchangeCode(input.code)
  if (!tokens.refresh_token) {
    // Without a refresh token the owner-sync model can't work later.
    throw new Error(
      'Google did not return a refresh token; re-consent required'
    )
  }
  const user = await fetchGoogleUser(tokens.access_token)
  await googleDriveIntegrationRepository.upsert({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    googleUserId: user.sub,
    googleEmail: user.email ?? null,
    scopes: [...GOOGLE_DRIVE_OAUTH_SCOPES],
  })
  // The external account's handle / email are not copied into the audit log.
  await recordAuditEvent({
    workspaceId: input.workspaceId,
    action: 'google_drive.connected',
    target: { type: 'integration', id: 'google_drive' },
    metadata: { scopes: [...GOOGLE_DRIVE_OAUTH_SCOPES] },
    context: audit,
  })
}

export async function disconnectIntegration(
  workspaceId: string,
  memberId: string,
  audit?: AuditContext
): Promise<void> {
  await googleDriveIntegrationRepository.delete(workspaceId, memberId)
  // Every disconnect request is recorded — the delete is idempotent, so the
  // row may already have been gone (LUM-907 PR3 ruling).
  await recordAuditEvent({
    workspaceId,
    action: 'google_drive.disconnected',
    target: { type: 'integration', id: 'google_drive' },
    context: audit,
  })
}

export async function getStatus(
  workspaceId: string,
  memberId: string
): Promise<{ connected: boolean; email: string | null; needsReauth: boolean }> {
  const row = await googleDriveIntegrationRepository.findByMember(
    workspaceId,
    memberId
  )
  if (!row) return { connected: false, email: null, needsReauth: false }
  return {
    connected: true,
    email: row.googleEmail,
    needsReauth: row.needsReauth,
  }
}

/**
 * Wrap the raw Drive client so a hard 401 (`GoogleNeedsReauthError`, thrown when
 * the client can't refresh the access token) flips the integration row's
 * `needsReauth` flag before the error propagates. The same error instance is
 * rethrown so callers' error handling is unchanged; any other error passes
 * through untouched.
 */
function wrapClient(
  raw: GoogleDriveClient,
  integrationId: string
): GoogleDriveClient {
  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof GoogleNeedsReauthError) {
        await googleDriveIntegrationRepository.markNeedsReauth(integrationId)
      }
      throw e
    }
  }
  return {
    getMetadata: fileId => guard(() => raw.getMetadata(fileId)),
    exportMarkdown: fileId => guard(() => raw.exportMarkdown(fileId)),
  }
}

/**
 * Build an authenticated Drive client for a specific member's stored tokens.
 * Used by the import/sync service. Refreshed tokens are persisted back via the
 * repository, and a hard 401 marks the row needsReauth (see {@link wrapClient}).
 */
export async function getClientForMember(
  workspaceId: string,
  memberId: string
): Promise<GoogleDriveClient> {
  const row = await googleDriveIntegrationRepository.findByMember(
    workspaceId,
    memberId
  )
  if (!row) {
    throw Object.assign(new Error('Google Drive not connected'), {
      status: 403,
      code: 'google_not_connected',
    })
  }
  if (row.needsReauth) {
    throw Object.assign(new Error('Google Drive needs reauth'), {
      status: 403,
      code: 'google_needs_reauth',
    })
  }
  const client = createGoogleDriveClient({
    tokens: {
      accessToken: decrypt(row.accessToken),
      refreshToken: decrypt(row.refreshToken),
      expiresAt: row.expiresAt,
    },
    onTokensRefreshed: async next => {
      await googleDriveIntegrationRepository.updateTokens(row.id, {
        accessToken: encrypt(next.accessToken),
        refreshToken: encrypt(next.refreshToken),
        expiresAt: next.expiresAt,
      })
    },
  })
  return wrapClient(client, row.id)
}
