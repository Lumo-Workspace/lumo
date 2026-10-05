import { encrypt, decrypt } from '@/lib/crypto'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import {
  exchangeCode,
  FIGMA_OAUTH_SCOPES,
} from '@/lib/integrations/figma/oauth'
import type { FigmaUserInfo } from '@/lib/integrations/figma/types'

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
    if (Date.now() - parsed.iat > OAUTH_STATE_TTL_MS) {
      return null
    }
    return {
      workspaceId: parsed.workspaceId,
      memberId: parsed.memberId,
      workspaceUrl: parsed.workspaceUrl,
    }
  } catch {
    return null
  }
}

async function fetchFigmaUser(accessToken: string): Promise<FigmaUserInfo> {
  const res = await fetch('https://api.figma.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Figma /v1/me failed: ${res.status}`)
  return (await res.json()) as FigmaUserInfo
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
  const user = await fetchFigmaUser(tokens.access_token)
  await figmaIntegrationRepository.upsert({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    figmaUserId: user.id,
    figmaHandle: user.handle,
    figmaEmail: user.email,
    scopes: [...FIGMA_OAUTH_SCOPES],
  })
  // The external account's handle / email are not copied into the audit log.
  await recordAuditEvent({
    workspaceId: input.workspaceId,
    action: 'figma.connected',
    target: { type: 'integration', id: 'figma' },
    metadata: { scopes: [...FIGMA_OAUTH_SCOPES] },
    context: audit,
  })
}

export async function disconnectIntegration(
  workspaceId: string,
  memberId: string,
  audit?: AuditContext
): Promise<void> {
  await figmaIntegrationRepository.delete(workspaceId, memberId)
  // Every disconnect request is recorded — the delete is idempotent, so the
  // row may already have been gone (LUM-907 PR3 ruling).
  await recordAuditEvent({
    workspaceId,
    action: 'figma.disconnected',
    target: { type: 'integration', id: 'figma' },
    context: audit,
  })
}

export async function getDecryptedTokens(
  workspaceId: string,
  memberId: string
): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
  integrationId: string
}> {
  const row = await figmaIntegrationRepository.findByMember(
    workspaceId,
    memberId
  )
  if (!row) {
    throw Object.assign(new Error('Figma not connected'), {
      status: 403,
      code: 'figma_not_connected',
    })
  }
  if (row.needsReauth) {
    throw Object.assign(new Error('Figma needs reauth'), {
      status: 403,
      code: 'figma_needs_reauth',
    })
  }
  return {
    accessToken: decrypt(row.accessToken),
    refreshToken: decrypt(row.refreshToken),
    expiresAt: row.expiresAt,
    integrationId: row.id,
  }
}
