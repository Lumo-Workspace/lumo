/**
 * LUM-907 PR3 — personal API keys (the lumo CLI, MCP clients, scripts).
 *
 * Extracted from the /api/users/api-keys routes, which used to talk to the
 * repository directly. A key belongs to one WorkspaceMember; only that member
 * lists, creates or revokes it. Creating and revoking a key are audited
 * (the key's id, label, prefix and scope — never the key or its hash).
 */
import { randomBytes, createHash } from 'crypto'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { API_KEY_SCOPES } from '@/lib/services/auth.service'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/** The member a key belongs to. */
export interface ApiKeyOwner {
  workspaceId: string
  memberId: string
}

/** `lum_` + 64 random hex chars; the stored hash and the shown prefix. */
export function generateApiKey(): {
  key: string
  keyHash: string
  keyPrefix: string
} {
  const key = `lum_${randomBytes(32).toString('hex')}`
  return {
    key,
    keyHash: createHash('sha256').update(key).digest('hex'),
    keyPrefix: key.slice(0, 16),
  }
}

/** A key scope from the request body: null = a full key; unknown = 400. */
export function parseApiKeyScope(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const scope = String(raw)
  if (!(API_KEY_SCOPES as readonly string[]).includes(scope)) {
    throw httpError(400, 'invalid scope')
  }
  return scope
}

export const apiKeyService = {
  /** The member's active (non-revoked) keys — prefix and metadata only. */
  async list(owner: ApiKeyOwner) {
    return miscRepository.findActiveApiKeys(owner.memberId)
  },

  /** Create a key. The full key is returned once and never stored. */
  async create(
    owner: ApiKeyOwner,
    input: { label: string; scope: unknown },
    audit?: AuditContext
  ) {
    const label = input.label.trim()
    if (!label) throw httpError(400, 'label is required')
    const scope = parseApiKeyScope(input.scope)
    const { key, keyHash, keyPrefix } = generateApiKey()
    const created = await miscRepository.createApiKey({
      workspaceMemberId: owner.memberId,
      label,
      keyHash,
      keyPrefix,
      scope,
    })
    await recordAuditEvent({
      workspaceId: owner.workspaceId,
      action: 'api_key.created',
      target: { type: 'api_key', id: created.id },
      metadata: { label, keyPrefix, scope },
      context: audit,
    })
    return { ...created, key }
  },

  /** Revoke (soft-delete) one of the member's own keys. */
  async revoke(owner: ApiKeyOwner, id: string, audit?: AuditContext) {
    const existing = await miscRepository.findApiKeyById(id)
    if (!existing || existing.workspaceMemberId !== owner.memberId) {
      throw httpError(404, 'Not found')
    }
    if (existing.revokedAt !== null) throw httpError(409, 'Already revoked')
    await miscRepository.revokeApiKey(id)
    // The key id links back to its api_key.created event (label, prefix).
    await recordAuditEvent({
      workspaceId: owner.workspaceId,
      action: 'api_key.revoked',
      target: { type: 'api_key', id },
      context: audit,
    })
  },
}
