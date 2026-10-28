import { randomBytes } from 'node:crypto'
import { getBlobStorage, resolveBlobBackend } from '@/lib/blob/storage'
import { resolveAppUrl, PUBLIC_CONFIG_GLOBAL } from '@/lib/config/public-config'
import { verifyEmailTransport } from '@/lib/integrations/email/client'
import { checkRealtimeConnection } from '@/lib/integrations/pusher/server'
import { getSharedRedisClient } from '@/lib/rate-limit/redis-client'
import { selfHostCheckRepository } from '@/lib/repositories/self-host-check.repository'

/**
 * LUM-1332 — `scripts/self-host/setup.sh` runs this after `docker compose up`
 * (through POST /api/internal/self-host-check) to tell the operator whether
 * what they configured actually works: every check talks to the real
 * service with the app's own env, from inside the app container.
 *
 * Each check is `ok`, `failed` (with a hint saying what to fix), or
 * `skipped` when its component is not configured. Optional components that
 * are skipped never fail the run; only `failed` does.
 */
export type CheckStatus = 'ok' | 'failed' | 'skipped'

export interface CheckResult {
  id: 'database' | 'storage' | 'email' | 'redis' | 'realtime' | 'public_url'
  status: CheckStatus
  detail: string
  hint?: string
}

type Env = Record<string, string | undefined>

/** A single check never holds up the report for longer than this. */
export const CHECK_TIMEOUT_MS = 15_000

/** The side effects the checks need, injectable for tests. */
export interface SelfHostProbes {
  pingDatabase(): Promise<void>
  /** Write, read back and delete one private object. */
  roundTripBlob(): Promise<void>
  verifyEmail: typeof verifyEmailTransport
  pingRedis(url: string): Promise<void>
  checkRealtime: typeof checkRealtimeConnection
  fetchUrl(url: string): Promise<{ status: number; body: string }>
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/**
 * The error's message, plus its cause's when there is one: `fetch` rejects
 * with a bare "fetch failed" whose cause says why (ENOTFOUND, ECONNREFUSED,
 * a certificate error).
 */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err).replace(/\/\/[^@\s/]*@/g, '//***@').slice(0, 200)
  const cause = (err as { cause?: unknown }).cause
  const why =
    cause instanceof Error
      ? [(cause as { code?: unknown }).code, cause.message].filter(Boolean).join(' ')
      : ''
  const text = why && !err.message.includes(why) ? `${err.message}: ${why}` : err.message
  // A driver may echo a connection URL; never its userinfo (password).
  return text.replace(/\/\/[^@\s/]*@/g, '//***@').slice(0, 200)
}

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not answer within ${CHECK_TIMEOUT_MS / 1000}s`)),
      CHECK_TIMEOUT_MS
    )
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkDatabase(probes: SelfHostProbes): Promise<CheckResult> {
  try {
    await withTimeout(probes.pingDatabase(), 'the database')
    return { id: 'database', status: 'ok', detail: 'connected, schema present' }
  } catch (err) {
    return {
      id: 'database',
      status: 'failed',
      detail: errorText(err),
      hint: 'Check DATABASE_URL and `docker compose logs app postgres`.',
    }
  }
}

async function checkStorage(
  probes: SelfHostProbes,
  env: Env
): Promise<CheckResult> {
  let backend: string
  try {
    backend = resolveBlobBackend(env)
  } catch (err) {
    return { id: 'storage', status: 'failed', detail: errorText(err) }
  }
  try {
    await withTimeout(probes.roundTripBlob(), 'file storage')
    return { id: 'storage', status: 'ok', detail: `${backend}: write, read and delete work` }
  } catch (err) {
    return {
      id: 'storage',
      status: 'failed',
      detail: `${backend}: ${errorText(err)}`,
      hint:
        backend === 's3'
          ? 'Check S3_BUCKET, S3_ENDPOINT, S3_REGION and the S3 credentials in .env.'
          : 'Check that the blob-data volume is mounted at LOCAL_BLOB_DIR and writable.',
    }
  }
}

async function checkEmail(probes: SelfHostProbes): Promise<CheckResult> {
  let result: Awaited<ReturnType<typeof verifyEmailTransport>>
  try {
    result = await withTimeout(probes.verifyEmail(), 'the SMTP server')
  } catch (err) {
    result = { status: 'failed', error: { name: 'Error', message: errorText(err) } }
  }
  if (result.status === 'not_configured') {
    return {
      id: 'email',
      status: 'skipped',
      detail: 'not configured',
      hint: 'Invites cannot be accepted without email: set SMTP_URL, SMTP_HOST or RESEND_API_KEY.',
    }
  }
  if (result.status === 'ok') {
    return {
      id: 'email',
      status: 'ok',
      detail:
        result.transport === 'resend_relay'
          ? 'Resend relay: connection and API key accepted (no mail sent)'
          : 'SMTP server: connection and login accepted (no mail sent)',
    }
  }
  const { code, statusCode, message } = result.error
  return {
    id: 'email',
    status: 'failed',
    detail: [code, statusCode, message].filter(Boolean).join(' '),
    hint:
      code === 'EAUTH'
        ? 'The server rejected the credentials: check SMTP_USER / SMTP_PASS (or RESEND_API_KEY).'
        : 'Check SMTP_URL or SMTP_HOST / SMTP_PORT / SMTP_SECURE, and that this server may reach it.',
  }
}

async function checkRedis(
  probes: SelfHostProbes,
  env: Env
): Promise<CheckResult> {
  const url = env.REDIS_URL?.trim()
  if (!url) {
    return { id: 'redis', status: 'skipped', detail: 'not configured (rate limits kept in memory)' }
  }
  try {
    await withTimeout(probes.pingRedis(url), 'Redis')
    return { id: 'redis', status: 'ok', detail: 'connected' }
  } catch (err) {
    return {
      id: 'redis',
      status: 'failed',
      detail: errorText(err),
      hint: 'Check REDIS_URL (rediss:// for TLS) and that this server may reach it.',
    }
  }
}

async function checkRealtime(probes: SelfHostProbes): Promise<CheckResult> {
  let result: Awaited<ReturnType<typeof checkRealtimeConnection>>
  try {
    result = await withTimeout(probes.checkRealtime(), 'the realtime server')
  } catch (err) {
    result = { status: 'failed', message: errorText(err) }
  }
  if (result.status === 'not_configured') {
    return {
      id: 'realtime',
      status: 'skipped',
      detail: 'off (the UI refreshes on focus and every minute)',
    }
  }
  if (result.status === 'ok') {
    return { id: 'realtime', status: 'ok', detail: 'server reachable, credentials accepted' }
  }
  return {
    id: 'realtime',
    status: 'failed',
    detail: result.message,
    hint: 'Check `docker compose logs soketi`; re-run setup.sh --realtime to restore its settings.',
  }
}

async function checkPublicUrl(
  probes: SelfHostProbes,
  appUrl: string | undefined
): Promise<CheckResult> {
  if (!appUrl) {
    return {
      id: 'public_url',
      status: 'failed',
      detail: 'NEXT_PUBLIC_APP_URL is not set',
      hint: 'Run setup.sh --url <public URL>.',
    }
  }
  let host: string
  try {
    host = new URL(appUrl).hostname
  } catch {
    return {
      id: 'public_url',
      status: 'failed',
      detail: `${appUrl} is not a valid URL`,
      hint: 'Run setup.sh --url <public URL>.',
    }
  }
  if (LOCAL_HOSTS.has(host)) {
    return {
      id: 'public_url',
      status: 'skipped',
      detail: `${appUrl} is local to this machine; open it in a browser`,
    }
  }
  try {
    const res = await withTimeout(
      probes.fetchUrl(`${appUrl}/api/public-config`),
      appUrl
    )
    if (res.status === 200 && res.body.includes(PUBLIC_CONFIG_GLOBAL)) {
      return { id: 'public_url', status: 'ok', detail: `${appUrl} serves this Lumo` }
    }
    return {
      id: 'public_url',
      status: 'failed',
      detail: `${appUrl} answered HTTP ${res.status}, not Lumo`,
      hint: 'Something else answers on that URL: check the reverse proxy routes it to port 3000.',
    }
  } catch (err) {
    return {
      id: 'public_url',
      status: 'failed',
      detail: `${appUrl}: ${errorText(err)}`,
      hint: appUrl.startsWith('https://')
        ? 'Check DNS points at this server, ports 80/443 are open, and HTTPS is served (setup.sh --caddy, or your own proxy).'
        : 'Check the host and port are reachable from this server.',
    }
  }
}

/** Run every check (concurrently) and return them in a fixed order. */
export async function runSelfHostChecks(
  probes: SelfHostProbes,
  env: Env = process.env,
  appUrl: string | undefined = resolveAppUrl()
): Promise<CheckResult[]> {
  return Promise.all([
    checkDatabase(probes),
    checkStorage(probes, env),
    checkEmail(probes),
    checkRedis(probes, env),
    checkRealtime(probes),
    checkPublicUrl(probes, appUrl),
  ])
}

/** The probes against the real services, through the app's own wrappers. */
export const defaultSelfHostProbes: SelfHostProbes = {
  pingDatabase: () => selfHostCheckRepository.pingDatabase(),
  async roundTripBlob() {
    const storage = await getBlobStorage()
    const pathname = `self-host-check/${randomBytes(8).toString('hex')}.txt`
    const stored = await storage.put(pathname, Buffer.from('ok'), {
      access: 'private',
      contentType: 'text/plain',
    })
    try {
      const opened = await storage.get(stored.pathname, 'private', { noCache: true })
      if (!opened) throw new Error('the file just written could not be read back')
      await opened.stream.cancel()
    } finally {
      await storage.delete(stored.pathname, 'private')
    }
  },
  verifyEmail: verifyEmailTransport,
  async pingRedis(url) {
    const client = await getSharedRedisClient(url)
    await client.eval('return 1', { keys: [], arguments: [] })
  },
  checkRealtime: checkRealtimeConnection,
  async fetchUrl(url) {
    const res = await fetch(url, { redirect: 'follow', cache: 'no-store' })
    return { status: res.status, body: (await res.text()).slice(0, 4096) }
  },
}
