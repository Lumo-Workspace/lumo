/**
 * LUM-735: GitHub Actions OIDC ID token verification.
 *
 * A customer's workflow asks GitHub for an ID token (`aud=lumo`) and sends it
 * as the bearer of a SARIF upload; this module is the only thing that decides
 * whether that token really came from GitHub, and for which repository. It is
 * deliberately dependency-free: RS256 is verified with Web Crypto
 * (`globalThis.crypto.subtle`, available in the Node.js runtime), and the JWKS
 * is fetched with `fetch` and cached in-process by `kid`.
 *
 * Every failure — bad signature, stale token, wrong audience, even a GitHub
 * JWKS outage — throws `Error & { status: 401 }`. Callers map that straight to
 * an HTTP status; a JWKS hiccup must not surface as a 500 stack trace on a
 * public ingest route.
 */

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
export const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`
/**
 * `||` rather than `??` on purpose: an env var that is set but empty (a common
 * accident in CI and in `.env` files) must fall back to `lumo`, not become an
 * empty expected audience that rejects every token GitHub ever issues.
 */
export const GITHUB_OIDC_AUDIENCE = process.env.LUMO_OIDC_AUDIENCE || 'lumo'
/** Hard ceiling on a single JWKS fetch; a hung GitHub must not hang ingest. */
export const GITHUB_OIDC_FETCH_TIMEOUT_MS = 3_000

/** Tolerated clock difference between GitHub and us, in seconds. */
const CLOCK_SKEW_SECONDS = 60
/** How long a fetched signing key stays usable without re-checking the JWKS. */
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000
/**
 * Minimum spacing between JWKS refreshes triggered by an unknown `kid`.
 * Without it, anyone can point a stream of made-up kids at a public route and
 * turn it into a JWKS request amplifier against GitHub.
 */
const JWKS_REFRESH_FLOOR_MS = 5_000

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const PULL_MERGE_REF = /^refs\/pull\/(\d+)\/merge$/

/** `owner/repo`, each segment as GitHub bounds them. */
const REPOSITORY_SHAPE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/
/** A full, lowercase git object id. */
const SHA_SHAPE = /^[0-9a-f]{40}$/
const MAX_REF_LENGTH = 200
const MAX_NAME_LENGTH = 100

/** Claims we care about, normalised out of the raw OIDC payload. */
export interface GithubActionsClaims {
  /** `owner/repo`, exactly as GitHub spelled it. */
  repository: string
  repositoryOwner: string
  /** e.g. `refs/pull/12/merge` for a `pull_request` run. */
  ref: string
  /** For `pull_request` events this is the merge commit, not the head sha. */
  sha: string
  eventName: string
  runId: string
  actor: string | null
}

export interface VerifyGithubActionsTokenOptions {
  /** Epoch milliseconds to validate `exp`/`nbf`/`iat` against. Default `Date.now()`. */
  now?: number
  /** Expected `aud`. Default {@link GITHUB_OIDC_AUDIENCE}. */
  audience?: string
}

interface CachedKey {
  key: CryptoKey
  fetchedAt: number
}

let jwksCache = new Map<string, CachedKey>()
/** When the last refresh *attempt* started, successful or not. */
let lastRefreshAt = 0
/**
 * When the last refresh attempt *failed*. Separate from `lastRefreshAt`
 * because it gates a different case: a failure means GitHub is unreachable, so
 * every kid is unresolvable until the floor elapses — including kids we hold a
 * stale cached entry for, which `lastRefreshAt` alone deliberately lets
 * through (that path exists to pick up a rotation promptly).
 */
let lastFailedRefreshAt = 0
/** The refresh currently in flight, shared by every concurrent caller. */
let inFlightRefresh: Promise<void> | null = null

/** Test seam: drop every cached signing key and the refresh bookkeeping. */
export function __resetJwksCacheForTests(): void {
  jwksCache = new Map()
  lastRefreshAt = 0
  lastFailedRefreshAt = 0
  inFlightRefresh = null
}

function unauthorized(reason: string): Error & { status: number } {
  return Object.assign(new Error(reason), { status: 401 })
}

/**
 * Cheap shape test used to route a bearer token to OIDC verification instead of
 * the ApiKey path. Not a validity claim — only "three base64url segments".
 */
export function looksLikeJwt(token: string): boolean {
  return JWT_SHAPE.test(token)
}

/** `refs/pull/12/merge` → `12`; anything else → `null`. */
export function pullNumberFromRef(ref: string): number | null {
  const match = PULL_MERGE_REF.exec(ref)
  if (!match) return null
  const n = Number(match[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function base64UrlToBytes(segment: string): Uint8Array<ArrayBuffer> {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '='
  )
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(segment))
  )
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unauthorized('malformed token')
  }
  return value as Record<string, unknown>
}

function readString(
  claims: Record<string, unknown>,
  name: string
): string | null {
  const value = claims[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Fetch the GitHub JWKS and *replace* the cache with exactly the RS256 signing
 * keys it advertises. Building a fresh map and swapping it in is the point: a
 * kid GitHub has retired (or revoked after a compromise) disappears from our
 * cache the moment we see a JWKS without it, instead of lingering until the
 * process restarts. A network error, a timeout, a non-2xx response or a body we
 * cannot parse all surface as 401 — GitHub being flaky is an auth failure here,
 * not a bug — and they leave the previous cache untouched.
 */
async function fetchJwks(): Promise<void> {
  lastRefreshAt = Date.now()

  let payload: unknown
  try {
    const response = await fetch(GITHUB_OIDC_JWKS_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(GITHUB_OIDC_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`JWKS request failed with status ${response.status}`)
    }
    payload = await response.json()
  } catch {
    throw unauthorized('unable to fetch GitHub OIDC signing keys')
  }

  const keys =
    payload && typeof payload === 'object'
      ? (payload as { keys?: unknown }).keys
      : undefined
  if (!Array.isArray(keys)) {
    throw unauthorized('unable to fetch GitHub OIDC signing keys')
  }

  const fetchedAt = Date.now()
  const next = new Map<string, CachedKey>()
  for (const entry of keys) {
    if (!entry || typeof entry !== 'object') continue
    const jwk = entry as JsonWebKey & { kid?: unknown }
    const kid = typeof jwk.kid === 'string' ? jwk.kid : null
    if (!kid) continue
    if (jwk.kty !== 'RSA') continue
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue
    if (jwk.use !== undefined && jwk.use !== 'sig') continue

    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { ...jwk, alg: 'RS256', use: 'sig', key_ops: ['verify'], ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      )
      next.set(kid, { key, fetchedAt })
    } catch {
      // A key we cannot import is a key we cannot verify with: skip it rather
      // than failing the whole JWKS (GitHub may add algorithms we don't know).
      continue
    }
  }

  jwksCache = next
}

/**
 * Single-flight wrapper around {@link fetchJwks}: a burst of requests arriving
 * on a cold cache (or right after a rotation) makes one JWKS request between
 * them, and every caller sees the same success or the same 401.
 */
function refreshJwks(): Promise<void> {
  if (inFlightRefresh) return inFlightRefresh
  const attempt = fetchJwks()
    .catch(error => {
      lastFailedRefreshAt = Date.now()
      throw error
    })
    .finally(() => {
      if (inFlightRefresh === attempt) inFlightRefresh = null
    })
  inFlightRefresh = attempt
  return attempt
}

/**
 * Resolve the signing key for `kid`.
 *
 * A cached entry is only usable while it is younger than the TTL; anything else
 * means asking GitHub again and then looking `kid` up in the *new* document
 * only, so a key that vanished from the JWKS can never be served from cache. An
 * unknown kid is the normal rotation signal, but it is also attacker-controlled,
 * so it may trigger a refresh at most once every {@link JWKS_REFRESH_FLOOR_MS}.
 *
 * The floor also covers the window after a *failed* refresh, whatever the cache
 * holds. During a GitHub outage the stale-entry path would otherwise re-fetch
 * on every single request, each one paying the full
 * {@link GITHUB_OIDC_FETCH_TIMEOUT_MS} before its 401 — turning an upstream
 * outage into a pile-up of slow requests on our side. Failing fast is the same
 * answer, sooner.
 */
async function getSigningKey(kid: string): Promise<CryptoKey> {
  const cached = jwksCache.get(kid)
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.key
  }

  // The floor gates *starting* a refresh; a refresh already in flight is free
  // to join, which is what keeps a cold-start burst down to one request.
  if (!inFlightRefresh) {
    const now = Date.now()
    const floored = cached
      ? now - lastFailedRefreshAt < JWKS_REFRESH_FLOOR_MS
      : now - lastRefreshAt < JWKS_REFRESH_FLOOR_MS
    if (floored) throw unauthorized('unknown token signing key')
  }

  await refreshJwks()

  const fetched = jwksCache.get(kid)
  if (fetched && Date.now() - fetched.fetchedAt < JWKS_CACHE_TTL_MS) {
    return fetched.key
  }

  throw unauthorized('unknown token signing key')
}

/**
 * Verify a GitHub Actions OIDC ID token and return its normalised claims.
 *
 * @throws `Error & { status: 401 }` for every rejection, with a short,
 *   caller-safe reason.
 */
export async function verifyGithubActionsToken(
  token: string,
  opts: VerifyGithubActionsTokenOptions = {}
): Promise<GithubActionsClaims> {
  if (!looksLikeJwt(token)) throw unauthorized('malformed token')

  const segments = token.split('.')
  const headerSegment = segments[0] ?? ''
  const payloadSegment = segments[1] ?? ''
  const signatureSegment = segments[2] ?? ''

  let header: Record<string, unknown>
  try {
    header = decodeJsonSegment(headerSegment)
  } catch {
    throw unauthorized('malformed token')
  }
  if (header.alg !== 'RS256') throw unauthorized('unsupported token algorithm')
  const kid = readString(header, 'kid')
  if (!kid) throw unauthorized('token is missing a signing key id')

  let payload: Record<string, unknown>
  let signature: Uint8Array<ArrayBuffer>
  try {
    payload = decodeJsonSegment(payloadSegment)
    signature = base64UrlToBytes(signatureSegment)
  } catch {
    throw unauthorized('malformed token')
  }

  // Issuer, audience and the time claims are checked *before* the JWKS lookup.
  // They cost nothing but a string compare, and they reject everything an
  // attacker can mint on their own — so a stream of junk tokens aimed at this
  // public route never reaches `getSigningKey`, and therefore never turns us
  // into a JWKS request amplifier against GitHub. These checks prove nothing on
  // their own (the payload is still unauthenticated here); the signature below
  // is what makes them mean anything, and every claim we go on to *use* is
  // re-read and shape-checked after it.
  if (payload.iss !== GITHUB_OIDC_ISSUER) {
    throw unauthorized('unexpected token issuer')
  }

  const audience = opts.audience ?? GITHUB_OIDC_AUDIENCE
  const aud = payload.aud
  const audienceOk = Array.isArray(aud)
    ? aud.includes(audience)
    : aud === audience
  if (!audienceOk) throw unauthorized('unexpected token audience')

  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000)
  const exp = payload.exp
  if (typeof exp !== 'number' || exp <= nowSeconds - CLOCK_SKEW_SECONDS) {
    throw unauthorized('token expired')
  }
  for (const name of ['nbf', 'iat'] as const) {
    const value = payload[name]
    if (typeof value === 'number' && value > nowSeconds + CLOCK_SKEW_SECONDS) {
      throw unauthorized('token is not valid yet')
    }
  }

  const key = await getSigningKey(kid)
  const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)
  let valid = false
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      signed
    )
  } catch {
    valid = false
  }
  if (!valid) throw unauthorized('invalid token signature')

  const repository = readString(payload, 'repository')
  const ref = readString(payload, 'ref')
  const sha = readString(payload, 'sha')
  if (!repository || !ref || !sha) {
    throw unauthorized('token is missing GitHub repository claims')
  }

  // Shape checks, after the signature: these claims flow into repo lookups, log
  // lines and PR comment URLs, so we only accept what GitHub actually emits and
  // reject anything else outright rather than truncating it into something that
  // still looks plausible downstream.
  if (!REPOSITORY_SHAPE.test(repository)) {
    throw unauthorized('unexpected repository claim')
  }
  if (!SHA_SHAPE.test(sha)) throw unauthorized('unexpected sha claim')
  if (ref.length > MAX_REF_LENGTH) throw unauthorized('unexpected ref claim')

  const repositoryOwner = readString(payload, 'repository_owner')
  const eventName = readString(payload, 'event_name')
  const actor = readString(payload, 'actor')
  for (const value of [repositoryOwner, eventName, actor]) {
    if (value !== null && value.length > MAX_NAME_LENGTH) {
      throw unauthorized('unexpected GitHub identity claim')
    }
  }

  const runId = payload.run_id
  return {
    repository,
    repositoryOwner:
      repositoryOwner ?? (repository.split('/')[0] || repository),
    ref,
    sha,
    eventName: eventName ?? '',
    runId:
      typeof runId === 'string' || typeof runId === 'number'
        ? String(runId)
        : '',
    actor,
  }
}
