/**
 * LUM-1341 — an OpenAPI client acting as one member (user_access_token).
 *
 * It refreshes an access token that is about to expire, or that Feishu
 * rejects as invalid/expired, and hands the rotated pair to
 * `onTokensRefreshed` — the refresh token is single-use, so the caller must
 * persist the new one before anything else uses the old one. A refresh that
 * cannot succeed again (no refresh token, refresh token expired, or Feishu
 * says it is dead) throws FeishuNeedsReauthError; a transient failure throws
 * the FeishuApiError as is, so a Feishu outage never forces a reconnect.
 */
import type { FeishuAppCredentials } from './config'
import { feishuHosts } from './config'
import { FeishuApiError, feishuRequest } from './http'
import { FEISHU_REFRESH_DEAD_CODES, refreshUserToken } from './oauth'

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
}

/** Refresh this long before the access token's own expiry. */
export const USER_TOKEN_REFRESH_MARGIN_MS = 60_000

/** Feishu codes for a user_access_token that is invalid or expired. */
const USER_TOKEN_REJECTED_CODES: readonly number[] = [99991668, 99991677, 20006]

/** Whether a refresh failure means the link is gone (vs. a transient error). */
export function isDeadRefreshError(error: unknown): boolean {
  if (!(error instanceof FeishuApiError)) return false
  if (error.code !== null && FEISHU_REFRESH_DEAD_CODES.includes(error.code)) {
    return true
  }
  // Other 4xx on the token endpoint (bad client, app disabled) need a human
  // too; 5xx / 20050 / 20072 are worth retrying later.
  return error.httpStatus >= 400 && error.httpStatus < 500
}

function isRejectedToken(error: unknown): boolean {
  return (
    error instanceof FeishuApiError &&
    (error.httpStatus === 401 ||
      (error.code !== null && USER_TOKEN_REJECTED_CODES.includes(error.code)))
  )
}

export function createFeishuUserClient(opts: {
  app: FeishuAppCredentials
  tokens: FeishuClientTokens
  onTokensRefreshed: (next: FeishuClientTokens) => Promise<void>
  now?: () => number
}): FeishuUserClient {
  const now = opts.now ?? (() => Date.now())
  let tokens = opts.tokens

  async function doRefresh(): Promise<void> {
    if (
      !tokens.refreshToken ||
      (tokens.refreshExpiresAt && tokens.refreshExpiresAt.getTime() <= now())
    ) {
      throw new FeishuNeedsReauthError()
    }
    let next
    try {
      next = await refreshUserToken({
        domain: opts.app.domain,
        appId: opts.app.appId,
        appSecret: opts.app.appSecret,
        refreshToken: tokens.refreshToken,
        now: now(),
      })
    } catch (error) {
      if (isDeadRefreshError(error)) throw new FeishuNeedsReauthError()
      throw error
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

  const send = (path: string) =>
    feishuRequest(
      `${feishuHosts(opts.app.domain).openBase}${path}`,
      { method: 'GET', token: tokens.accessToken },
      path.split('?')[0]!
    )

  return {
    async get(path) {
      if (tokens.expiresAt.getTime() - now() <= USER_TOKEN_REFRESH_MARGIN_MS) {
        await doRefresh()
      }
      try {
        return await send(path)
      } catch (error) {
        if (!isRejectedToken(error)) throw error
        await doRefresh()
        try {
          return await send(path)
        } catch (retryError) {
          if (isRejectedToken(retryError)) throw new FeishuNeedsReauthError()
          throw retryError
        }
      }
    },
  }
}
