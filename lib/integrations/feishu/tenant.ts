/**
 * LUM-1341 — the app's own identity: tenant_access_token for a self-built
 * (自建) app, and the tenant it belongs to.
 *
 * - POST {open}/open-apis/auth/v3/tenant_access_token/internal  { app_id, app_secret }
 *   → { code, msg, tenant_access_token, expire }. Valid up to 2 h; asking
 *   again with < 30 min left returns a fresh one (both stay valid).
 *   https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
 * - GET {open}/open-apis/tenant/v2/tenant/query (scope tenant:tenant:readonly)
 *   → data.tenant { name, tenant_key, ... }
 *   https://open.feishu.cn/document/server-docs/tenant-v2/query
 *
 * The App Store (ISV, app_ticket) flow is out of scope (LUM-1341 Decision 2).
 */
import { feishuHosts, type FeishuAppCredentials } from './config'
import { feishuRequest } from './http'
import type { FeishuTenantInfo, FeishuTenantToken } from './types'

/** Refresh a cached tenant token this long before it expires. */
export const TENANT_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

export async function fetchTenantAccessToken(
  app: FeishuAppCredentials,
  now: number = Date.now()
): Promise<FeishuTenantToken> {
  const body = await feishuRequest(
    `${feishuHosts(app.domain).openBase}/open-apis/auth/v3/tenant_access_token/internal`,
    { method: 'POST', json: { app_id: app.appId, app_secret: app.appSecret } },
    'auth/v3/tenant_access_token/internal'
  )
  const token = body.tenant_access_token
  const expire = body.expire
  if (typeof token !== 'string' || typeof expire !== 'number') {
    throw new Error('Feishu tenant token response is missing fields')
  }
  return { token, expiresAt: new Date(now + expire * 1000) }
}

export async function fetchTenantInfo(
  app: Pick<FeishuAppCredentials, 'domain'>,
  tenantToken: string
): Promise<FeishuTenantInfo> {
  const body = await feishuRequest(
    `${feishuHosts(app.domain).openBase}/open-apis/tenant/v2/tenant/query`,
    { method: 'GET', token: tenantToken },
    'tenant/v2/tenant/query'
  )
  const tenant = ((body.data ?? {}) as Record<string, unknown>).tenant as
    | Record<string, unknown>
    | undefined
  if (
    !tenant ||
    typeof tenant.tenant_key !== 'string' ||
    typeof tenant.name !== 'string'
  ) {
    throw new Error('Feishu tenant query is missing tenant_key or name')
  }
  return { tenantKey: tenant.tenant_key, name: tenant.name }
}

/** Whether a cached tenant token is still good for at least the margin. */
export function isTenantTokenFresh(
  expiresAt: Date | null,
  now: number = Date.now()
): boolean {
  return (
    expiresAt !== null &&
    expiresAt.getTime() - now > TENANT_TOKEN_REFRESH_MARGIN_MS
  )
}
