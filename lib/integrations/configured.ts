/**
 * LUM-1025 — is an optional integration CONFIGURED on this deployment?
 *
 * "Configured" is a deployment fact read from env: the operator supplied the
 * credentials the integration needs. It is NOT "connected", which is per
 * tenant and scoped differently per integration (Slack and the GitHub App are
 * per workspace, GitHub OAuth / Figma / Google Drive per member). An unconfigured integration cannot be connected
 * by anyone, so the UI hides it and server paths skip it instead of failing.
 *
 * The minimal deployment is Postgres + Clerk; everything listed here is
 * optional. Pure and import-light (no SDKs, no `fs`), so the security-scan
 * config modules, route handlers and server components can all share it.
 */
import type { IntegrationId } from './registry'

type Env = Record<string, string | undefined>

/** Registry integrations plus the platform capabilities that need env. */
export type ConfigurableIntegration =
  | IntegrationId
  /** Firecracker VMs for the managed scan, baseline, hunt and verifier. */
  | 'vercelSandbox'
  /** Headless Chromium escalation for link previews (OG metadata). */
  | 'chromium'

export interface IntegrationConfigStatus {
  configured: boolean
  /** Env vars that are missing (empty when configured or not env-shaped). */
  missing: string[]
}

/**
 * Tokens/state for every OAuth-style integration are AES-GCM encrypted with
 * ENCRYPTION_KEY (lib/crypto.ts), so it is a requirement of each of them.
 */
const ENCRYPTION_KEY = 'ENCRYPTION_KEY'

const REQUIRED_ENV: Record<
  Exclude<ConfigurableIntegration, 'vercelSandbox' | 'chromium'>,
  readonly string[]
> = {
  slack: [
    'SLACK_CLIENT_ID',
    'SLACK_CLIENT_SECRET',
    'SLACK_SIGNING_SECRET',
    ENCRYPTION_KEY,
  ],
  // The App installation: install redirect (slug), installation tokens
  // (id + key), installer verification (client id/secret) and webhooks.
  github: [
    'GITHUB_APP_SLUG',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
    'GITHUB_APP_WEBHOOK_SECRET',
    ENCRYPTION_KEY,
  ],
  // The member's OAuth identity link.
  githubAccount: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', ENCRYPTION_KEY],
  // Sentry credentials are per workspace (entered in the card); only the
  // encryption of the stored client secret is a deployment requirement.
  sentry: [ENCRYPTION_KEY],
  figma: [
    'FIGMA_OAUTH_CLIENT_ID',
    'FIGMA_OAUTH_CLIENT_SECRET',
    'FIGMA_OAUTH_REDIRECT_URI',
    ENCRYPTION_KEY,
  ],
  googleDrive: [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_DRIVE_OAUTH_REDIRECT_URI',
    ENCRYPTION_KEY,
  ],
}

function present(env: Env, name: string): boolean {
  const v = env[name]
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * `@vercel/sandbox` authenticates only through a Vercel OIDC token (we never
 * pass explicit credentials): automatic inside a Vercel Function (`VERCEL=1`),
 * `VERCEL_OIDC_TOKEN` from `vercel env pull` everywhere else.
 */
function sandboxStatus(env: Env): IntegrationConfigStatus {
  const configured = env.VERCEL === '1' || present(env, 'VERCEL_OIDC_TOKEN')
  return { configured, missing: configured ? [] : ['VERCEL_OIDC_TOKEN'] }
}

/**
 * Chromium needs a browser binary rather than a credential:
 * - `LUMO_OG_CHROMIUM=off` / `on` force it;
 * - `CHROME_PATH` points at an installed Chrome;
 * - on Vercel the `@sparticuz/chromium-min` pack runs as-is;
 * - local dev on macOS / Windows uses the system Chrome (the old default).
 * Anywhere else (a self-hosted Linux box) it is off by default — the pack
 * needs system libraries a slim image lacks — and previews use plain fetch.
 */
function chromiumStatus(
  env: Env,
  platform: string | undefined
): IntegrationConfigStatus {
  const os = platform ?? process.platform
  const flag = env.LUMO_OG_CHROMIUM
  let configured: boolean
  if (flag === 'off') configured = false
  else if (flag === 'on') configured = true
  else
    configured =
      present(env, 'CHROME_PATH') ||
      env.VERCEL === '1' ||
      env.IS_LOCAL === '1' ||
      (env.NODE_ENV === 'development' && (os === 'darwin' || os === 'win32'))
  return { configured, missing: configured ? [] : ['CHROME_PATH'] }
}

export function integrationConfigStatus(
  id: ConfigurableIntegration,
  env: Env = process.env,
  /** Only read for `chromium`; defaults to `process.platform`. */
  platform?: string
): IntegrationConfigStatus {
  if (id === 'vercelSandbox') return sandboxStatus(env)
  if (id === 'chromium') return chromiumStatus(env, platform)
  const missing = REQUIRED_ENV[id].filter(name => !present(env, name))
  return { configured: missing.length === 0, missing }
}

export function isIntegrationConfigured(
  id: ConfigurableIntegration,
  env: Env = process.env
): boolean {
  return integrationConfigStatus(id, env).configured
}

/** Every registry integration's configured flag — what the settings page renders. */
export function configuredRegistryIntegrations(
  env: Env = process.env
): Record<IntegrationId, boolean> {
  const ids = Object.keys(REQUIRED_ENV) as IntegrationId[]
  return Object.fromEntries(
    ids.map(id => [id, isIntegrationConfigured(id, env)])
  ) as Record<IntegrationId, boolean>
}

/**
 * Log reason for a sandbox-backed workflow (managed scan, baseline, hunt,
 * verifier) that was skipped rather than started. Defense in depth: the
 * kill switches already read the same fact, so stage A never asks.
 */
export const SANDBOX_NOT_CONFIGURED =
  'Vercel Sandbox is not configured on this deployment'
