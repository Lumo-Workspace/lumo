/**
 * LUM-1341 — an OpenAPI client acting as one member (user_access_token).
 *
 * It refreshes an access token that is about to expire, or that Feishu
 * rejects as invalid/expired, and hands the rotated pair to
 * `onTokensRefreshed` — the refresh token is single-use, so the caller must
 * persist the new one before anything else uses the old one.
 *
 * Concurrency: the refresh token is single-use, so two refreshes of the same
 * pair cannot both succeed.
 * - In one client, concurrent calls share one in-flight refresh.
 * - Across clients / processes, a refresh that fails as dead first re-reads
 *   the stored tokens (`reloadTokens`); if another refresh already rotated
 *   them, this client adopts the new pair and carries on.
 *
 * A refresh that cannot succeed again (no refresh token, refresh token
 * expired, or Feishu says the link is dead) and was not rotated elsewhere
 * throws FeishuNeedsReauthError. Anything else — rate limits, 5xx, app
 * misconfiguration an operator must fix — throws the FeishuApiError as is,
 * so it never forces members to reconnect.
 */
import type { FeishuAppCredentials } from './config'
import { feishuHosts } from './config'
import {
  FeishuApiError,
  feishuRequest,
  feishuRequestBinary,
  type FeishuBinary,
} from './http'
import { refreshUserToken } from './oauth'

export class FeishuNeedsReauthError extends Error {
  constructor() {
    super('Feishu account needs to be reconnected')
    this.name = 'FeishuNeedsReauthError'
  }
}

export interface FeishuClientTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  refreshExpiresAt: Date | null
}

export interface FeishuUserClient {
  /** GET an `/open-apis/...` path; returns the response body on success. */
  get(path: string): Promise<Record<string, unknown>>
  /** GET a file stream (LUM-1343: doc images), same token handling as get. */
  getBinary(path: string): Promise<FeishuBinary>
}

/** Refresh this long before the access token's own expiry. */
export const USER_TOKEN_REFRESH_MARGIN_MS = 60_000

/** Feishu codes for a user_access_token that is invalid or expired. */
const USER_TOKEN_REJECTED_CODES: readonly number[] = [99991668, 99991677, 20006]

/**
 * Refresh failures that mean THIS member's link is gone and only a reconnect
 * fixes it (https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token):
 *   20024 refresh token belongs to another app · 20026 invalid ·
 *   20037 expired · 20064 revoked · 20073 already used ·
 *   20008 user no longer exists · 20010 user lost access to the app ·
 *   20066 user status invalid (e.g. deactivated).
 *
 * Deliberately NOT dead (transient or an operator problem a reconnect would
 * not fix): HTTP 429 and the rate-limit codes, 5xx / 20050 / 20072, and the
 * app-level codes 20002 (client secret), 20009 (app not installed in the
 * tenant), 20048 (app missing), 20069 (app disabled), 20074 (refresh
 * disabled). An unknown 4xx is also treated as transient: retrying later is
 * cheaper than making a member reconnect for nothing.
 */
export const FEISHU_DEAD_REFRESH_CODES: readonly number[] = [
  20008, 20010, 20024, 20026, 20037, 20064, 20066, 20073,
]

/**
 * Feishu rate-limit codes (https://open.feishu.cn/document/server-docs/api-call-guide/frequency-control,
 * generic error codes): 99991400 frequency limit, 90217 too many requests,
 * 1000004 method rate limited, 1000005 app rate limited.
 */
export const FEISHU_RATE_LIMIT_CODES: readonly number[] = [
  99991400, 90217, 1000004, 1000005,
]

/** How often a lost refresh race re-reads the stored tokens before giving up. */
const ROTATION_RELOAD_ATTEMPTS = 3
const ROTATION_RELOAD_DELAY_MS = 250

/** Whether a refresh failure means the link is gone (vs. a transient error). */
export function isDeadRefreshError(error: unknown): boolean {
  if (!(error instanceof FeishuApiError)) return false
  if (error.httpStatus === 429) return false
  if (error.code === null) return false
  if (FEISHU_RATE_LIMIT_CODES.includes(error.code)) return false
  return FEISHU_DEAD_REFRESH_CODES.includes(error.code)
}

function isRejectedToken(error: unknown): boolean {
  return (
    error instanceof FeishuApiError &&
    (error.httpStatus === 401 ||
      (error.code !== null && USER_TOKEN_REJECTED_CODES.includes(error.code)))
  )
}

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

export function createFeishuUserClient(opts: {
  app: FeishuAppCredentials
  tokens: FeishuClientTokens
  onTokensRefreshed: (next: FeishuClientTokens) => Promise<void>
  /**
   * The member's tokens as currently stored, for a refresh that lost a race
   * with another client. Without it a dead refresh is final.
   */
  reloadTokens?: () => Promise<FeishuClientTokens | null>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): FeishuUserClient {
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? defaultSleep
  let tokens = opts.tokens
  let inFlight: Promise<void> | null = null

  /** Adopt a pair another client stored after rotating `used`. */
  async function adoptRotated(used: string): Promise<boolean> {
    if (!opts.reloadTokens) return false
    for (let attempt = 0; attempt < ROTATION_RELOAD_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(ROTATION_RELOAD_DELAY_MS)
      const stored = await opts.reloadTokens()
      if (stored && stored.refreshToken !== used) {
        tokens = stored
        return true
      }
    }
    return false
  }

  async function doRefresh(): Promise<void> {
    const used = tokens.refreshToken
    if (
      !used ||
      (tokens.refreshExpiresAt && tokens.refreshExpiresAt.getTime() <= now())
    ) {
      if (await adoptRotated(used)) return
      throw new FeishuNeedsReauthError()
    }
    let next
    try {
      next = await refreshUserToken({
        domain: opts.app.domain,
        appId: opts.app.appId,
        appSecret: opts.app.appSecret,
        refreshToken: used,
        now: now(),
      })
    } catch (error) {
      if (!isDeadRefreshError(error)) throw error
      if (await adoptRotated(used)) return
      throw new FeishuNeedsReauthError()
    }
    if (!next.refreshToken) {
      // offline_access was withdrawn: this token is the last one we get.
      throw new FeishuNeedsReauthError()
    }
    tokens = {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: next.expiresAt,
      refreshExpiresAt: next.refreshExpiresAt,
    }
    await opts.onTokensRefreshed(tokens)
  }

  /** One refresh at a time per client; concurrent callers share it. */
  function refresh(): Promise<void> {
    if (!inFlight) {
      inFlight = doRefresh().finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }

  const send = (path: string, accessToken: string) =>
    feishuRequest(
      `${feishuHosts(opts.app.domain).openBase}${path}`,
      { method: 'GET', token: accessToken },
      path.split('?')[0]!
    )

  const sendBinary = (path: string, accessToken: string) =>
    feishuRequestBinary(
      `${feishuHosts(opts.app.domain).openBase}${path}`,
      { token: accessToken },
      path.split('?')[0]!
    )

  /** Refresh near expiry, send, and retry once on a rejected token. */
  async function withToken<T>(
    sendWith: (accessToken: string) => Promise<T>
  ): Promise<T> {
    if (inFlight) await inFlight
    if (tokens.expiresAt.getTime() - now() <= USER_TOKEN_REFRESH_MARGIN_MS) {
      await refresh()
    }
    const usedToken = tokens.accessToken
    try {
      return await sendWith(usedToken)
    } catch (error) {
      if (!isRejectedToken(error)) throw error
      // Another call may already have replaced the token we sent.
      if (tokens.accessToken === usedToken) await refresh()
      try {
        return await sendWith(tokens.accessToken)
      } catch (retryError) {
        if (isRejectedToken(retryError)) throw new FeishuNeedsReauthError()
        throw retryError
      }
    }
  }

  return {
    get: path => withToken(token => send(path, token)),
    getBinary: path => withToken(token => sendBinary(path, token)),
  }
}
