/**
 * LUM-1341 — the Feishu / Lark connection, foundation for LUM-1342 (chat
 * context) and LUM-1343 (doc import).
 *
 * Two lines, like GitHub:
 * - `feishu` (TEAM): one self-built (自建) app per deployment. An owner
 *   "installs" it by signing in with Feishu; the tenant they sign in to must
 *   be the app's own tenant, so a Lumo workspace can only bind a Feishu
 *   tenant one of its owners belongs to. The app's tenant_access_token is
 *   cached encrypted and refreshed before it expires.
 * - `feishuAccount` (PERSONAL): a member's user_access_token, in the
 *   installed tenant, refreshed with its single-use refresh token. A refresh
 *   that can never succeed again marks the link `needsReauth`.
 *
 * Tokens never reach a log or an audit row. Disconnecting deletes them.
 * Behind the `feishu-integration` rollout flag (dogfood).
 */
import { encrypt, decrypt } from '@/lib/crypto'
import { isFeatureEnabled } from '@/lib/features/is-enabled'
import {
  feishuAppCredentials,
  feishuRedirectUri,
  type FeishuAppCredentials,
} from '@/lib/integrations/feishu/config'
import {
  createFeishuUserClient,
  FeishuNeedsReauthError,
  type FeishuUserClient,
} from '@/lib/integrations/feishu/client'
import {
  exchangeCode,
  fetchUserInfo,
  FEISHU_ACCOUNT_SCOPES,
  FEISHU_INSTALL_SCOPES,
  getAuthorizeUrl,
} from '@/lib/integrations/feishu/oauth'
import {
  fetchTenantAccessToken,
  fetchTenantInfo,
  isTenantTokenFresh,
} from '@/lib/integrations/feishu/tenant'
import { encodeOauthState } from '@/lib/integrations/oauth-state'
import { feishuIntegrationRepository } from '@/lib/repositories/feishu-integration.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

// ── Types ───────────────────────────────────────────────────────────────────

export type FeishuInstallStatus =
  | { connected: false }
  | {
      connected: true
      tenantName: string
      domain: string
      /** Installed for another app id / domain than this deployment's. */
      reinstallRequired: boolean
    }

export interface FeishuAccountStatus {
  /** Whether the workspace has the app installed (a link needs it). */
  installed: boolean
  connected: boolean
  name: string | null
  needsReauth: boolean
}

/** Short, stable reasons a flow can fail with; the callback puts them in the URL. */
export type FeishuFlowError =
  | 'not_owner'
  | 'not_installed'
  | 'tenant_mismatch'
  | 'no_refresh_token'
  /** Another Lumo workspace already holds this Feishu tenant. */
  | 'tenant_taken'
  /** The install was made with another app id / domain than the env's. */
  | 'reinstall_required'

function flowError(code: FeishuFlowError, status: number, message: string) {
  return Object.assign(new Error(message), { status, code })
}

interface StartFlowInput {
  workspaceId: string
  memberId: string
  workspaceUrl: string
  appUrl: string
}

// ── Guards ──────────────────────────────────────────────────────────────────

/** Flag off: the integration does not exist for this workspace. */
export function isFeishuEnabled(workspaceId: string): boolean {
  return isFeatureEnabled('feishu-integration', workspaceId)
}

function requireEnabled(workspaceId: string): void {
  if (!isFeishuEnabled(workspaceId)) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
}

function requireOwner(role: string): void {
  if (role !== 'OWNER') {
    throw flowError(
      'not_owner',
      403,
      'Only workspace owners can connect or disconnect Feishu'
    )
  }
}

/**
 * Whether a stored install belongs to the app this deployment runs now. A
 * changed FEISHU_APP_ID or FEISHU_DOMAIN makes the binding (and any cached
 * tenant token, which is the other app's) stale until an owner reinstalls.
 */
export function isInstallCurrent(
  install: { domain: string; appId: string },
  app: Pick<FeishuAppCredentials, 'domain' | 'appId'>
): boolean {
  return install.domain === app.domain && install.appId === app.appId
}

/**
 * The deployment's app for a read-only status check: null instead of a throw
 * when FEISHU_APP_ID / FEISHU_APP_SECRET are missing or FEISHU_DOMAIN is
 * invalid, so a status GET never turns into a 500. No app means no install
 * can be current.
 */
function currentAppOrNull(): FeishuAppCredentials | null {
  try {
    return feishuAppCredentials()
  } catch {
    return null
  }
}

function isCurrentFor(
  install: { domain: string; appId: string },
  app: FeishuAppCredentials | null
): boolean {
  return app !== null && isInstallCurrent(install, app)
}

function requireCurrent(
  install: { domain: string; appId: string },
  app: Pick<FeishuAppCredentials, 'domain' | 'appId'>
): void {
  if (!isInstallCurrent(install, app)) {
    throw flowError(
      'reinstall_required',
      409,
      'Feishu was connected with a different app; an owner must reconnect it'
    )
  }
}

// ── Workspace install (TEAM) ────────────────────────────────────────────────

/** Where an owner is sent to sign in with Feishu to install the app. */
export function buildInstallAuthorizeUrl(
  input: StartFlowInput & { role: string }
): string {
  requireEnabled(input.workspaceId)
  requireOwner(input.role)
  const app = feishuAppCredentials()
  const state = encodeOauthState({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    workspaceUrl: input.workspaceUrl,
    purpose: 'feishu-install',
  })
  return getAuthorizeUrl({
    domain: app.domain,
    appId: app.appId,
    redirectUri: feishuRedirectUri('install', input.appUrl),
    scopes: FEISHU_INSTALL_SCOPES,
    state,
  })
}

/**
 * Finish the owner's install leg: the owner's tenant must be the app's own
 * tenant, then the workspace is bound to it and the tenant token cached. The
 * owner's own user token is used once for user_info and not stored.
 */
export async function completeInstall(
  input: {
    workspaceId: string
    memberId: string
    role: string
    code: string
    appUrl: string
  },
  audit?: AuditContext
): Promise<void> {
  requireEnabled(input.workspaceId)
  requireOwner(input.role)
  const app = feishuAppCredentials()
  const userToken = await exchangeCode({
    domain: app.domain,
    appId: app.appId,
    appSecret: app.appSecret,
    code: input.code,
    redirectUri: feishuRedirectUri('install', input.appUrl),
  })
  const user = await fetchUserInfo(app.domain, userToken.accessToken)
  const tenantToken = await fetchTenantAccessToken(app)
  const tenant = await fetchTenantInfo(app, tenantToken.token)
  if (user.tenantKey !== tenant.tenantKey) {
    throw flowError(
      'tenant_mismatch',
      403,
      'The Feishu account is not in the app’s tenant'
    )
  }
  const written = await feishuIntegrationRepository.upsertInstall({
    workspaceId: input.workspaceId,
    installedBy: input.memberId,
    domain: app.domain,
    appId: app.appId,
    tenantKey: tenant.tenantKey,
    tenantName: tenant.name,
    tenantAccessToken: encrypt(tenantToken.token),
    tenantTokenExpiresAt: tenantToken.expiresAt,
  })
  if (written === 'tenant_taken') {
    throw flowError(
      'tenant_taken',
      409,
      'This Feishu organization is already connected to another Lumo workspace'
    )
  }
  await recordAuditEvent({
    workspaceId: input.workspaceId,
    action: 'feishu.connected',
    target: { type: 'integration', id: 'feishu' },
    metadata: { domain: app.domain },
    context: audit,
  })
}

export async function getInstallStatus(
  workspaceId: string
): Promise<FeishuInstallStatus> {
  if (!isFeishuEnabled(workspaceId)) return { connected: false }
  const row = await feishuIntegrationRepository.findInstallStatus(workspaceId)
  if (!row) return { connected: false }
  return {
    connected: true,
    tenantName: row.tenantName,
    domain: row.domain,
    reinstallRequired: !isCurrentFor(row, currentAppOrNull()),
  }
}

/**
 * Owner only. Deletes the binding, the cached tenant token and — in the same
 * transaction — every member's account link, whose tokens belong to it.
 */
export async function disconnectInstall(
  workspaceId: string,
  role: string,
  audit?: AuditContext
): Promise<void> {
  requireEnabled(workspaceId)
  requireOwner(role)
  const removed = await feishuIntegrationRepository.deleteInstall(workspaceId)
  await recordAuditEvent({
    workspaceId,
    action: 'feishu.disconnected',
    target: { type: 'integration', id: 'feishu' },
    context: audit,
  })
  if (removed.accounts > 0) {
    await recordAuditEvent({
      workspaceId,
      action: 'feishu.member_accounts_removed',
      target: { type: 'integration', id: 'feishu_account' },
      metadata: { count: removed.accounts },
      context: audit,
    })
  }
}

/**
 * The app's tenant_access_token for this workspace's install — the cached one
 * while it has more than the margin left, else a fresh one (persisted).
 */
export async function getTenantAccessToken(
  workspaceId: string,
  now: number = Date.now()
): Promise<string> {
  const row =
    await feishuIntegrationRepository.findInstallWithToken(workspaceId)
  if (!row) {
    throw flowError('not_installed', 404, 'Feishu is not connected')
  }
  const app = feishuAppCredentials()
  // Never hand out a cached token minted for another app.
  requireCurrent(row, app)
  if (
    row.tenantAccessToken &&
    isTenantTokenFresh(row.tenantTokenExpiresAt, now)
  ) {
    return decrypt(row.tenantAccessToken)
  }
  const next = await fetchTenantAccessToken(app, now)
  const stored = await feishuIntegrationRepository.updateTenantToken(
    workspaceId,
    row.id,
    {
      tenantAccessToken: encrypt(next.token),
      tenantTokenExpiresAt: next.expiresAt,
    }
  )
  if (!stored) {
    // Disconnected while we were fetching: there is no install to act for.
    throw flowError('not_installed', 404, 'Feishu is not connected')
  }
  return next.token
}

// ── Member account link (PERSONAL) ──────────────────────────────────────────

/** The workspace's current install (no token), or a 409 flow error. */
async function requireInstall(
  workspaceId: string,
  app: Pick<FeishuAppCredentials, 'domain' | 'appId'>
) {
  const row = await feishuIntegrationRepository.findInstallStatus(workspaceId)
  if (!row) {
    throw flowError(
      'not_installed',
      409,
      'Feishu is not connected to this workspace yet'
    )
  }
  requireCurrent(row, app)
  return row
}

/** Where a member is sent to link their Feishu account. */
export async function buildAccountAuthorizeUrl(
  input: StartFlowInput
): Promise<string> {
  requireEnabled(input.workspaceId)
  const app = feishuAppCredentials()
  await requireInstall(input.workspaceId, app)
  const state = encodeOauthState({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    workspaceUrl: input.workspaceUrl,
    purpose: 'feishu-account',
  })
  return getAuthorizeUrl({
    domain: app.domain,
    appId: app.appId,
    redirectUri: feishuRedirectUri('account', input.appUrl),
    scopes: FEISHU_ACCOUNT_SCOPES,
    state,
  })
}

export async function completeAccountLink(
  input: {
    workspaceId: string
    memberId: string
    code: string
    appUrl: string
  },
  audit?: AuditContext
): Promise<void> {
  requireEnabled(input.workspaceId)
  const app = feishuAppCredentials()
  const install = await requireInstall(input.workspaceId, app)
  const token = await exchangeCode({
    domain: app.domain,
    appId: app.appId,
    appSecret: app.appSecret,
    code: input.code,
    redirectUri: feishuRedirectUri('account', input.appUrl),
  })
  if (!token.refreshToken) {
    // Without offline_access the link would die in ~2 hours.
    throw flowError(
      'no_refresh_token',
      400,
      'Feishu did not grant offline access'
    )
  }
  const user = await fetchUserInfo(app.domain, token.accessToken)
  if (user.tenantKey !== install.tenantKey) {
    throw flowError(
      'tenant_mismatch',
      403,
      'The Feishu account is not in this workspace’s tenant'
    )
  }
  await feishuIntegrationRepository.upsertAccount({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    domain: app.domain,
    tenantKey: user.tenantKey,
    openId: user.openId,
    name: user.name,
    accessToken: encrypt(token.accessToken),
    refreshToken: encrypt(token.refreshToken),
    expiresAt: token.expiresAt,
    refreshExpiresAt: token.refreshExpiresAt,
    scopes: token.scopes,
  })
  // The external account's name is not copied into the audit log.
  await recordAuditEvent({
    workspaceId: input.workspaceId,
    action: 'feishu_account.connected',
    target: { type: 'integration', id: 'feishu_account' },
    metadata: { scopes: token.scopes },
    context: audit,
  })
}

export async function getAccountStatus(
  workspaceId: string,
  memberId: string
): Promise<FeishuAccountStatus> {
  const none = {
    installed: false,
    connected: false,
    name: null,
    needsReauth: false,
  }
  if (!isFeishuEnabled(workspaceId)) return none
  const [install, row] = await Promise.all([
    feishuIntegrationRepository.findInstallStatus(workspaceId),
    feishuIntegrationRepository.findAccount(workspaceId, memberId),
  ])
  // A link counts only against a current install of the same tenant.
  const installed =
    install !== null && isCurrentFor(install, currentAppOrNull())
  const connected =
    installed && row !== null && row.tenantKey === install.tenantKey
  return {
    installed,
    connected,
    name: connected ? (row?.name ?? null) : null,
    needsReauth: connected ? (row?.needsReauth ?? false) : false,
  }
}

/** The member's own link (the route); idempotent. Deletes the stored tokens. */
export async function disconnectAccount(
  workspaceId: string,
  memberId: string,
  audit?: AuditContext
): Promise<void> {
  requireEnabled(workspaceId)
  await removeAccountLink(workspaceId, memberId, audit)
}

/**
 * Delete a member's link whatever the rollout flag says — also used when a
 * member is deactivated (lib/services/member-integrations.service.ts), where
 * leftover tokens must go even if the flag has since been turned off.
 */
export async function removeAccountLink(
  workspaceId: string,
  memberId: string,
  audit?: AuditContext
): Promise<void> {
  await feishuIntegrationRepository.deleteAccount(workspaceId, memberId)
  // Every request is recorded — the delete is idempotent (LUM-907 PR3 ruling).
  await recordAuditEvent({
    workspaceId,
    action: 'feishu_account.disconnected',
    target: { type: 'integration', id: 'feishu_account' },
    context: audit,
  })
}

/**
 * Whether the member has a link in this workspace (for deactivation cleanup,
 * lib/services/member-integrations.service.ts).
 */
export async function hasAccountLink(
  workspaceId: string,
  memberId: string
): Promise<boolean> {
  return (
    (await feishuIntegrationRepository.findAccount(workspaceId, memberId)) !==
    null
  )
}

/**
 * A client acting as the member. Rotated tokens are persisted with a
 * compare-and-swap on the stored refresh token, so two processes refreshing
 * the same single-use token cannot overwrite each other; the loser re-reads
 * the stored pair and carries on (lib/integrations/feishu/client.ts). Only a
 * refresh that can never succeed again, with nothing rotated meanwhile, marks
 * the link needsReauth — and only while it still holds that refresh token —
 * so the card asks the member to reconnect.
 */
export async function getUserClientForMember(
  workspaceId: string,
  memberId: string
): Promise<FeishuUserClient> {
  const row = await feishuIntegrationRepository.findAccount(
    workspaceId,
    memberId
  )
  if (!row) {
    throw Object.assign(new Error('Feishu account not connected'), {
      status: 403,
      code: 'feishu_not_connected',
    })
  }
  if (row.needsReauth) {
    throw Object.assign(new Error('Feishu account needs reauth'), {
      status: 403,
      code: 'feishu_needs_reauth',
    })
  }
  // The link is only usable under a current install of the same tenant.
  const app = feishuAppCredentials()
  const install = await requireInstall(workspaceId, app)
  if (install.tenantKey !== row.tenantKey) {
    throw flowError(
      'not_installed',
      409,
      'The Feishu account belongs to another tenant than the install'
    )
  }
  // The refresh-token ciphertext this client believes is stored: the
  // compare-and-swap key for every write below.
  let storedRefreshToken = row.refreshToken
  const raw = createFeishuUserClient({
    app,
    tokens: {
      accessToken: decrypt(row.accessToken),
      refreshToken: decrypt(row.refreshToken),
      expiresAt: row.expiresAt,
      refreshExpiresAt: row.refreshExpiresAt,
    },
    onTokensRefreshed: async next => {
      const refreshToken = encrypt(next.refreshToken)
      const stored = await feishuIntegrationRepository.updateAccountTokens(
        workspaceId,
        row.id,
        storedRefreshToken,
        {
          accessToken: encrypt(next.accessToken),
          refreshToken,
          expiresAt: next.expiresAt,
          refreshExpiresAt: next.refreshExpiresAt,
        }
      )
      // Lost the write to another refresh: keep using our (valid) pair in
      // memory, never overwrite theirs.
      if (stored) storedRefreshToken = refreshToken
    },
    reloadTokens: async () => {
      const current = await feishuIntegrationRepository.findAccount(
        workspaceId,
        memberId
      )
      if (!current || current.id !== row.id) return null
      storedRefreshToken = current.refreshToken
      return {
        accessToken: decrypt(current.accessToken),
        refreshToken: decrypt(current.refreshToken),
        expiresAt: current.expiresAt,
        refreshExpiresAt: current.refreshExpiresAt,
      }
    },
  })
  return {
    async get(path) {
      try {
        return await raw.get(path)
      } catch (error) {
        if (error instanceof FeishuNeedsReauthError) {
          await feishuIntegrationRepository.markAccountNeedsReauth(
            workspaceId,
            row.id,
            storedRefreshToken
          )
        }
        throw error
      }
    },
  }
}
