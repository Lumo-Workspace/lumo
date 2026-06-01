import * as fs from 'fs'
import * as path from 'path'

const SENSITIVE_SEGMENTS = ['.ssh', '.aws', '.gnupg']
const SENSITIVE_BASENAMES = [
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.htpasswd',
]
const SENSITIVE_EXTENSIONS = ['.pem', '.key', '.pfx', '.p12']

/**
 * Pure denylist check. Returns a human-readable reason when the path looks
 * like a secret, or null when it is acceptable. Matches the basename
 * (case-insensitive) and path segments; no filesystem access.
 */
export function matchSensitiveName(p: string): string | null {
  const segments = p.split(/[\\/]+/).filter(Boolean)
  for (const seg of segments) {
    if (SENSITIVE_SEGMENTS.includes(seg.toLowerCase())) {
      return `path contains ${seg}`
    }
  }
  const base = (segments[segments.length - 1] ?? '').toLowerCase()
  if (base === '.env' || base.startsWith('.env.')) return 'matches .env'
  if (SENSITIVE_BASENAMES.includes(base)) return `matches ${base}`
  for (const ext of SENSITIVE_EXTENSIONS) {
    if (base.endsWith(ext)) return `matches *${ext}`
  }
  return null
}

export interface PathGuardDeps {
  cwd: () => string
  realpath: (p: string) => string
}

export type PathGuardResult =
  | { ok: true; resolved: string }
  | { ok: false; reason: 'sensitive'; detail: string }
  | { ok: false; reason: 'outside-project'; detail: string }
  | { ok: false; reason: 'unreadable'; detail: string }

/**
 * Decide whether `rawPath` is safe to read and upload as an artifact body.
 * Two layers: (1) it must resolve to a real path inside the project directory
 * (cwd), and (2) neither the raw nor the canonical path may match the
 * sensitive-filename denylist. realpath defeats symlinks that escape the tree.
 * NOTE: there is a TOCTOU window between this check and the caller's read;
 * the caller reads the returned canonical `resolved` path to narrow it.
 */
export function checkArtifactFilePath(
  rawPath: string,
  deps?: Partial<PathGuardDeps>
): PathGuardResult {
  const cwd = deps?.cwd ?? process.cwd
  const realpath = deps?.realpath ?? fs.realpathSync

  // 1. Fail fast on the raw path (no fs access).
  const rawHit = matchSensitiveName(rawPath)
  if (rawHit) return { ok: false, reason: 'sensitive', detail: rawHit }

  const root = cwd()
  const absolute = path.resolve(root, rawPath)

  // 2. Canonicalize. realpath throws if the path does not exist / is unreadable.
  let resolved: string
  let rootReal: string
  try {
    resolved = realpath(absolute)
    rootReal = realpath(root)
  } catch {
    return { ok: false, reason: 'unreadable', detail: 'path does not resolve' }
  }

  // 3. Re-check the denylist on the canonical path (catches innocent-looking
  //    symlinks pointing at a secret).
  const canonHit = matchSensitiveName(resolved)
  if (canonHit) return { ok: false, reason: 'sensitive', detail: canonHit }

  // The path must be a file inside the project, not the project root itself.
  if (resolved === rootReal) {
    return {
      ok: false,
      reason: 'outside-project',
      detail: 'path resolves to the project root, not a file',
    }
  }

  // 4. Confinement: the canonical path must be inside the project root.
  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    return {
      ok: false,
      reason: 'outside-project',
      detail: 'resolves outside project directory',
    }
  }

  return { ok: true, resolved }
}
