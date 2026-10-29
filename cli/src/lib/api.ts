const DEFAULT_API_URL = 'https://www.uselumo.ai'

// Hostnames allowed to use plaintext http:// — local dev only. Everything
// else MUST be https:// so the Bearer token is never sent in the clear.
// `URL.hostname` returns IPv6 literals wrapped in brackets, so `::1` appears
// as `[::1]`.
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Throw if `url` is not a safe target for sending the API token.
 *
 * The CLI attaches a `Bearer` token (and the hook runner POSTs full session
 * content) to whatever `LUMO_API_URL` resolves to. An attacker who can set
 * that env var could otherwise exfiltrate the token / session stream by
 * pointing it at their own host, or downgrade to http:// to sniff it in
 * plaintext. We therefore require https://, with an http:// exception for
 * localhost so local dev still works.
 */
export function assertSafeApiUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid LUMO_API_URL: "${url}" is not a valid URL`)
  }
  if (parsed.protocol === 'https:') return
  if (parsed.protocol === 'http:' && LOCALHOST_HOSTNAMES.has(parsed.hostname)) {
    return
  }
  throw new Error(
    `Refusing to use insecure API URL "${url}": only https:// is allowed ` +
      `(http:// permitted for localhost only). This protects your API token ` +
      `and session data from being sent in plaintext or to an untrusted host.`
  )
}

/**
 * Return a prominent warning when the resolved API host differs from the host
 * the credentials were issued for, otherwise null. Compares hostname only
 * (case-insensitive, courtesy of URL parsing). Used to warn-then-send: a host
 * change is suspicious (possible token exfiltration) but intentional dev/env
 * redirects are legitimate, so we surface it rather than block.
 */
export function hostMismatchWarning(
  resolvedUrl: string,
  credsApiUrl: string
): string | null {
  let resolvedHost: string
  let credsHost: string
  try {
    resolvedHost = new URL(resolvedUrl).hostname
    credsHost = new URL(credsApiUrl).hostname
  } catch {
    return null
  }
  if (resolvedHost === credsHost) return null
  return (
    `⚠ LUMO_API_URL points at "${resolvedHost}" but your credentials were ` +
    `issued for "${credsHost}". Your API token will be sent there. If you did ` +
    `not set this, your token may be exfiltrated — unset LUMO_API_URL.`
  )
}

/**
 * Resolve the API URL for an authenticated command: prefer a non-empty
 * `LUMO_API_URL` override, else the baked-in `credsApiUrl`. The resolved URL
 * is validated (throws on an insecure target) and any host-mismatch warning is
 * routed to `opts.warn` (defaults to stderr via console.error).
 */
export function resolveAuthedApiUrl(
  credsApiUrl: string,
  opts?: { warn?: (message: string) => void }
): string {
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : credsApiUrl
  assertSafeApiUrl(apiUrl)
  const warning = hostMismatchWarning(apiUrl, credsApiUrl)
  if (warning) (opts?.warn ?? ((m: string) => console.error(m)))(warning)
  return apiUrl
}

export function resolveApiUrl(): string {
  const url = process.env.LUMO_API_URL?.trim()
  const resolved = url && url.length > 0 ? url : DEFAULT_API_URL
  assertSafeApiUrl(resolved)
  return resolved
}

/** The local-mode refusal codes the server answers with (LUM-1335). */
const LOCAL_MODE_ERROR_PREFIX = 'local_mode_'

/**
 * LUM-1335 — ask a self-hosted server in local mode (`LUMO_MODE=local`) for
 * an API key, so `lumo auth login` needs no copy-paste there. `refused` is
 * only a local-mode server's own refusal (several accounts), with its reason;
 * any other answer — 404 from the hosted service or a normal self-host, or an
 * unrelated error — is `unavailable`, which means "paste a key".
 */
export type LocalCliKeyResult =
  | { status: 'issued'; key: string }
  | { status: 'unavailable' }
  | { status: 'refused'; message: string }

export async function requestLocalCliKey(
  apiUrl: string
): Promise<LocalCliKeyResult> {
  let res: Response
  try {
    res = await fetch(
      `${trimTrailingSlash(apiUrl)}/api/auth/lumo/local-cli-key`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach Lumo API at ${apiUrl} (${msg})`)
  }
  let body: { key?: unknown; error?: unknown; message?: unknown }
  try {
    body = (await res.json()) as typeof body
  } catch {
    return { status: 'unavailable' }
  }
  if (res.status === 201 && typeof body.key === 'string' && body.key) {
    return { status: 'issued', key: body.key }
  }
  if (
    typeof body.error === 'string' &&
    body.error.startsWith(LOCAL_MODE_ERROR_PREFIX)
  ) {
    const reason = typeof body.message === 'string' ? body.message : body.error
    return { status: 'refused', message: reason }
  }
  return { status: 'unavailable' }
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Pull the `error` field out of a JSON API error body; non-JSON bodies (or
 * JSON without an `error` string) fall back to the raw text unchanged.
 */
export function extractErrorMessage(text: string): string {
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text
  } catch {
    return text
  }
}

export interface VerifyResponse {
  user: { id: string; email: string; name: string }
  workspace: { id: string; slug: string; name: string }
  apiKey: { id: string; name: string; prefix: string }
}

/**
 * `opts.signal` aborts the request itself (connect, headers and body), so a
 * caller's timeout also closes the socket instead of leaving it open.
 */
export async function verifyToken(
  apiUrl: string,
  token: string,
  opts: { signal?: AbortSignal } = {}
): Promise<VerifyResponse> {
  let res: Response
  try {
    res = await fetch(`${trimTrailingSlash(apiUrl)}/api/auth/verify`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach Lumo API at ${apiUrl} (${msg})`)
  }
  if (res.status === 401) {
    throw new Error('Invalid or revoked API key')
  }
  if (!res.ok) {
    throw new Error(`Verify failed: HTTP ${res.status}`)
  }
  return (await res.json()) as VerifyResponse
}
