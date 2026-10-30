/**
 * LUM-1341 — Feishu / Lark user OAuth (user_access_token).
 *
 * Endpoints, verified 2026-10-29:
 * - Authorize: GET {accounts}/open-apis/authen/v1/authorize
 *   https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code
 * - Token + refresh: POST {open}/open-apis/authen/v2/oauth/token (JSON)
 *   https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token
 *   https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token
 *   A refresh_token is only issued when `offline_access` is granted, and it
 *   is single-use: every refresh returns a new one that must replace it.
 * - User info: GET {open}/open-apis/authen/v1/user_info
 *   https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get
 */
import { feishuHosts, type FeishuDomain } from './config'
import { feishuRequest } from './http'
import type { FeishuUserInfo, FeishuUserToken } from './types'

/**
 * What a member's account link asks for: a refresh token, and read access to
 * the docs (docx) and wiki pages they can already see — what LUM-1343 imports.
 * Each must also be enabled on the app in the developer console.
 */
export const FEISHU_ACCOUNT_SCOPES = [
  'offline_access',
  'docx:document:readonly',
  'wiki:wiki:readonly',
] as const

/**
 * The owner's install leg only proves who they are and which tenant they
 * belong to (user_info needs no scope), so it requests none.
 */
export const FEISHU_INSTALL_SCOPES = [] as const

/**
 * Refresh-token codes that mean the link is gone for good: invalid (20026),
 * expired (20037), revoked (20064), already used (20073) or minted for
 * another app (20024). Anything else (5xx, 20050, 20072) is transient.
 */
export const FEISHU_REFRESH_DEAD_CODES: readonly number[] = [
  20024, 20026, 20037, 20064, 20073,
]

export function getAuthorizeUrl(opts: {
  domain: FeishuDomain
  appId: string
  redirectUri: string
  scopes: readonly string[]
  state: string
}): string {
  const url = new URL(
    '/open-apis/authen/v1/authorize',
    feishuHosts(opts.domain).accountsBase
  )
  url.searchParams.set('client_id', opts.appId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', opts.redirectUri)
  if (opts.scopes.length > 0) {
    url.searchParams.set('scope', opts.scopes.join(' '))
  }
  url.searchParams.set('state', opts.state)
  return url.toString()
}

function parseToken(
  body: Record<string, unknown>,
  now: number
): FeishuUserToken {
  const accessToken = body.access_token
  const expiresIn = body.expires_in
  if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
    throw new Error('Feishu token response is missing access_token')
  }
  const refreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token : null
  const refreshIn =
    typeof body.refresh_token_expires_in === 'number'
      ? body.refresh_token_expires_in
      : null
  return {
    accessToken,
    expiresAt: new Date(now + expiresIn * 1000),
    refreshToken,
    refreshExpiresAt:
      refreshToken && refreshIn !== null
        ? new Date(now + refreshIn * 1000)
        : null,
    scopes:
      typeof body.scope === 'string'
        ? body.scope.split(' ').filter(s => s.length > 0)
        : [],
  }
}

function tokenUrl(domain: FeishuDomain): string {
  return `${feishuHosts(domain).openBase}/open-apis/authen/v2/oauth/token`
}

export async function exchangeCode(opts: {
  domain: FeishuDomain
  appId: string
  appSecret: string
  code: string
  redirectUri: string
  now?: number
}): Promise<FeishuUserToken> {
  const body = await feishuRequest(
    tokenUrl(opts.domain),
    {
      method: 'POST',
      json: {
        grant_type: 'authorization_code',
        client_id: opts.appId,
        client_secret: opts.appSecret,
        code: opts.code,
        redirect_uri: opts.redirectUri,
      },
    },
    'oauth/token (authorization_code)'
  )
  return parseToken(body, opts.now ?? Date.now())
}

export async function refreshUserToken(opts: {
  domain: FeishuDomain
  appId: string
  appSecret: string
  refreshToken: string
  now?: number
}): Promise<FeishuUserToken> {
  const body = await feishuRequest(
    tokenUrl(opts.domain),
    {
      method: 'POST',
      json: {
        grant_type: 'refresh_token',
        client_id: opts.appId,
        client_secret: opts.appSecret,
        refresh_token: opts.refreshToken,
      },
    },
    'oauth/token (refresh_token)'
  )
  return parseToken(body, opts.now ?? Date.now())
}

export async function fetchUserInfo(
  domain: FeishuDomain,
  accessToken: string
): Promise<FeishuUserInfo> {
  const body = await feishuRequest(
    `${feishuHosts(domain).openBase}/open-apis/authen/v1/user_info`,
    { method: 'GET', token: accessToken },
    'authen/v1/user_info'
  )
  const data = (body.data ?? {}) as Record<string, unknown>
  if (typeof data.open_id !== 'string' || typeof data.tenant_key !== 'string') {
    throw new Error('Feishu user_info is missing open_id or tenant_key')
  }
  return {
    openId: data.open_id,
    tenantKey: data.tenant_key,
    name: typeof data.name === 'string' && data.name ? data.name : null,
  }
}
