import { randomBytes } from 'crypto'
import { encrypt, decrypt } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import { isFeatureEnabled } from '@/lib/features/is-enabled'
import {
  createCodeupClient,
  isCodeupAuthError,
  type CodeupClient,
  type CodeupRepositorySummary,
} from '@/lib/integrations/codeup/client'
import { hashWebhookToken } from '@/lib/integrations/codeup/webhook'
import { codeupRepository } from '@/lib/repositories/codeup.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import { resolveAppUrl } from '@/lib/config/public-config'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CodeupRepositoryOption {
  repositoryId: number
  pathWithNamespace: string
  webUrl: string
  confirmed: boolean
}

export type CodeupStatus =
  | { connected: false }
  | {
      connected: true
      organizationId: string
      repositories: Array<{
        repositoryId: number
        pathWithNamespace: string
        webUrl: string
      }>
    }

type StoredConnection = NonNullable<
  Awaited<ReturnType<typeof codeupRepository.findConnectionByWorkspace>>
>

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Where Codeup delivers this deployment's webhooks. No configured app URL
 * is an error, not a localhost fallback: a hook pointing at localhost would
 * be created on Codeup and silently never deliver.
 */
export function codeupWebhookUrl(
  appUrl: string | undefined = resolveAppUrl()
): string {
  const base = appUrl?.trim().replace(/\/+$/, '')
  if (!base) {
    throw Object.assign(
      new Error('NEXT_PUBLIC_APP_URL is not configured on this deployment'),
      { status: 500 }
    )
  }
  return `${base}/api/webhooks/codeup`
}

/** A fresh per-repository webhook secret (256 bits, hex). */
export function newWebhookToken(): string {
  return randomBytes(32).toString('hex')
}

function requireEnabled(workspaceId: string): void {
  // Flag off: the integration does not exist for this workspace.
  if (!isFeatureEnabled('codeup-integration', workspaceId)) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
}

async function requireConnection(
  workspaceId: string
): Promise<StoredConnection> {
  const connection =
    await codeupRepository.findConnectionByWorkspace(workspaceId)
  if (!connection) {
    throw Object.assign(new Error('Codeup not connected'), { status: 404 })
  }
  return connection
}

function clientFor(connection: StoredConnection): CodeupClient {
  return createCodeupClient(
    connection.organizationId,
    decrypt(connection.accessToken)
  )
}

/** Codeup refused or failed a call: a refused token is the caller's 400. */
function codeupFailure(err: unknown, what: string): Error {
  if (isCodeupAuthError(err)) {
    return Object.assign(
      new Error('Codeup rejected the organization ID or access token'),
      { status: 400 }
    )
  }
  logger.warn(`[codeup] ${what} failed`, { error: String(err) })
  return Object.assign(new Error('Codeup is not reachable right now'), {
    status: 502,
  })
}

function toOptions(
  available: CodeupRepositorySummary[],
  confirmedIds: Set<number>
): CodeupRepositoryOption[] {
  return available
    .map(repo => ({
      repositoryId: repo.id,
      pathWithNamespace: repo.pathWithNamespace,
      webUrl: repo.webUrl,
      confirmed: confirmedIds.has(repo.id),
    }))
    .sort((a, b) => a.pathWithNamespace.localeCompare(b.pathWithNamespace))
}

function confirmedIdsOf(connection: StoredConnection): Set<number> {
  return new Set(
    connection.repositories
      .filter(r => r.confirmedAt !== null)
      .map(r => r.repositoryId)
  )
}

/** Best-effort: remove Lumo's hook from a repository on Codeup. */
async function removeHook(
  client: CodeupClient,
  repositoryId: number,
  webhookId: number | null
): Promise<void> {
  if (webhookId === null) return
  try {
    await client.deleteWebhook(repositoryId, webhookId)
  } catch (err) {
    logger.warn(
      `[codeup] could not delete webhook ${webhookId} on repository ${repositoryId}`,
      { error: String(err) }
    )
  }
}

// ── Codeup Service ──────────────────────────────────────────────────────────

export const codeupService = {
  /** Whether the workspace is connected, and its confirmed repositories. */
  async getStatus(workspaceId: string): Promise<CodeupStatus> {
    requireEnabled(workspaceId)
    const connection =
      await codeupRepository.findConnectionByWorkspace(workspaceId)
    if (!connection) return { connected: false }
    return {
      connected: true,
      organizationId: connection.organizationId,
      repositories: connection.repositories
        .filter(r => r.confirmedAt !== null)
        .map(r => ({
          repositoryId: r.repositoryId,
          pathWithNamespace: r.pathWithNamespace,
          webUrl: r.webUrl,
        })),
    }
  },

  /**
   * Connect (or reconnect) the workspace. The token is checked by listing the
   * organization's repositories first: a refused token stores nothing.
   */
  async connect(
    workspaceId: string,
    memberId: string,
    role: string,
    data: { organizationId: string; accessToken: string },
    audit?: AuditContext
  ): Promise<CodeupRepositoryOption[]> {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can connect Codeup'),
        { status: 403 }
      )
    }
    requireEnabled(workspaceId)

    let available: CodeupRepositorySummary[]
    try {
      available = await createCodeupClient(
        data.organizationId,
        data.accessToken
      ).listRepositories()
    } catch (err) {
      throw codeupFailure(err, 'connect')
    }

    const existing =
      await codeupRepository.findConnectionByWorkspace(workspaceId)
    const switchingOrg =
      existing !== null && existing.organizationId !== data.organizationId
    // Built before the token is replaced: the old hooks belong to the old token.
    const oldClient = switchingOrg && existing ? clientFor(existing) : null

    // Store the new connection first, so a failure below never leaves the
    // workspace without one.
    const stored = await codeupRepository.upsertConnection({
      workspaceId,
      organizationId: data.organizationId,
      accessToken: encrypt(data.accessToken),
      connectedBy: memberId,
    })

    // A different organization makes the old confirmations meaningless: drop
    // their hooks (best effort, with the old token) and their rows.
    if (oldClient && existing) {
      for (const repo of existing.repositories) {
        await removeHook(oldClient, repo.repositoryId, repo.webhookId)
      }
      await codeupRepository.deleteRepositoriesOfConnection(stored.id)
    }
    await recordAuditEvent({
      workspaceId,
      action: 'codeup.connected',
      target: { type: 'integration', id: 'codeup' },
      metadata: { organizationId: data.organizationId },
      context: audit,
    })

    const kept =
      existing && existing.organizationId === data.organizationId
        ? confirmedIdsOf(existing)
        : new Set<number>()
    return toOptions(available, kept)
  },

  /**
   * The organization's repositories, each marked confirmed or not. Owner
   * only: the list is read with the owner's token, which can see
   * repositories a member may not.
   */
  async listRepositories(
    workspaceId: string,
    role: string
  ): Promise<CodeupRepositoryOption[]> {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can choose Codeup repositories'),
        { status: 403 }
      )
    }
    requireEnabled(workspaceId)
    const connection = await requireConnection(workspaceId)
    let available: CodeupRepositorySummary[]
    try {
      available = await clientFor(connection).listRepositories()
    } catch (err) {
      throw codeupFailure(err, 'list repositories')
    }
    return toOptions(available, confirmedIdsOf(connection))
  },

  /**
   * Replace the confirmed set. Each newly confirmed repository gets its own
   * webhook with a fresh random token (only its hash is stored); each one
   * dropped has its hook removed and stops being confirmed. Ids are checked
   * against what Codeup lists for the token — a path is never taken from
   * the client.
   */
  async updateRepositories(
    workspaceId: string,
    role: string,
    repositoryIds: number[],
    audit?: AuditContext
  ): Promise<CodeupStatus> {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can choose Codeup repositories'),
        { status: 403 }
      )
    }
    requireEnabled(workspaceId)
    const connection = await requireConnection(workspaceId)
    const client = clientFor(connection)

    let available: CodeupRepositorySummary[]
    try {
      available = await client.listRepositories()
    } catch (err) {
      throw codeupFailure(err, 'list repositories')
    }
    const byId = new Map(available.map(r => [r.id, r]))
    const wanted = new Set(repositoryIds)
    for (const id of wanted) {
      if (!byId.has(id)) {
        throw Object.assign(
          new Error('A selected repository is not in this organization'),
          { status: 400 }
        )
      }
    }

    // Resolved before any hook is created: a deployment without an app URL
    // is a configuration error (500), not Codeup being unreachable.
    const webhookUrl = codeupWebhookUrl()
    const confirmed = confirmedIdsOf(connection)
    let added = 0
    let removed = 0
    for (const id of wanted) {
      if (confirmed.has(id)) continue
      const repo = byId.get(id)!
      const token = newWebhookToken()
      let hook: { id: number }
      try {
        hook = await client.createWebhook(id, {
          url: webhookUrl,
          token,
        })
      } catch (err) {
        throw codeupFailure(err, `create webhook on ${id}`)
      }
      await codeupRepository.upsertRepository({
        connectionId: connection.id,
        repositoryId: id,
        pathWithNamespace: repo.pathWithNamespace,
        webUrl: repo.webUrl,
        webhookId: hook.id,
        webhookTokenHash: hashWebhookToken(token),
        confirmedAt: new Date(),
      })
      added++
    }
    for (const row of connection.repositories) {
      if (row.confirmedAt === null || wanted.has(row.repositoryId)) continue
      await removeHook(client, row.repositoryId, row.webhookId)
      await codeupRepository.markUnconfirmed(row.id)
      removed++
    }

    await recordAuditEvent({
      workspaceId,
      action: 'codeup.repositories_updated',
      target: { type: 'integration', id: 'codeup' },
      metadata: { added, removed },
      context: audit,
    })
    return codeupService.getStatus(workspaceId)
  },

  /** Disconnect: remove Lumo's hooks (best effort) and the stored token. */
  async disconnect(
    workspaceId: string,
    role: string,
    audit?: AuditContext
  ): Promise<void> {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can disconnect Codeup'),
        { status: 403 }
      )
    }
    requireEnabled(workspaceId)
    const connection = await requireConnection(workspaceId)
    const client = clientFor(connection)
    for (const repo of connection.repositories) {
      await removeHook(client, repo.repositoryId, repo.webhookId)
    }
    await codeupRepository.deleteConnection(connection.id)
    await recordAuditEvent({
      workspaceId,
      action: 'codeup.disconnected',
      target: { type: 'integration', id: 'codeup' },
      context: audit,
    })
  },
}
