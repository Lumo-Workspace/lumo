/**
 * LUM-1341 — deployment config for the Feishu / Lark connection.
 *
 * One self-built (自建) app per deployment: `FEISHU_APP_ID` and
 * `FEISHU_APP_SECRET` identify it, and `FEISHU_DOMAIN` picks the platform it
 * lives on. Feishu (open.feishu.cn) and Lark (open.larksuite.com) are the same
 * API on two hosts; an app exists on exactly one of them, so the domain is a
 * deployment fact, not a per-workspace choice.
 *
 * Hosts (verified 2026-10-29 against the open-platform docs):
 * - OpenAPI:   https://open.feishu.cn/open-apis/...   · https://open.larksuite.com/open-apis/...
 * - Authorize: https://accounts.feishu.cn/open-apis/authen/v1/authorize
 *              https://accounts.larksuite.com/open-apis/authen/v1/authorize
 */

type Env = Record<string, string | undefined>

export type FeishuDomain = 'feishu' | 'lark'

export const FEISHU_DOMAINS: readonly FeishuDomain[] = ['feishu', 'lark']

interface FeishuHosts {
  /** Base for every `/open-apis/...` call. */
  openBase: string
  /** Base for the browser-facing authorize page. */
  accountsBase: string
}

const HOSTS: Record<FeishuDomain, FeishuHosts> = {
  feishu: {
    openBase: 'https://open.feishu.cn',
    accountsBase: 'https://accounts.feishu.cn',
  },
  lark: {
    openBase: 'https://open.larksuite.com',
    accountsBase: 'https://accounts.larksuite.com',
  },
}

/**
 * The platform this deployment's app lives on. Unset or blank means Feishu;
 * anything other than `feishu` / `lark` is a configuration error, never a
 * silent fallback (a Lark app's credentials sent to Feishu just fail).
 */
export function resolveFeishuDomain(env: Env = process.env): FeishuDomain {
  const raw = (env.FEISHU_DOMAIN ?? '').trim().toLowerCase()
  if (raw === '') return 'feishu'
  if ((FEISHU_DOMAINS as readonly string[]).includes(raw)) {
    return raw as FeishuDomain
  }
  throw new Error(
    `FEISHU_DOMAIN must be one of ${FEISHU_DOMAINS.join(', ')} (got "${raw}")`
  )
}

export function feishuHosts(domain: FeishuDomain): FeishuHosts {
  return HOSTS[domain]
}

export interface FeishuAppCredentials {
  appId: string
  appSecret: string
  domain: FeishuDomain
}

/** The app's credentials; throws when the deployment is not configured. */
export function feishuAppCredentials(
  env: Env = process.env
): FeishuAppCredentials {
  const appId = env.FEISHU_APP_ID?.trim()
  const appSecret = env.FEISHU_APP_SECRET?.trim()
  if (!appId) throw new Error('Missing env var: FEISHU_APP_ID')
  if (!appSecret) throw new Error('Missing env var: FEISHU_APP_SECRET')
  return { appId, appSecret, domain: resolveFeishuDomain(env) }
}

/** Which of the two OAuth legs a redirect URI belongs to. */
export type FeishuOauthLeg = 'install' | 'account'

/**
 * The redirect URI registered in the app's security settings for each leg.
 * Both must be added there; authorize and token exchange must send the same
 * value.
 */
export function feishuRedirectUri(leg: FeishuOauthLeg, appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/feishu/${leg}/callback`
}
