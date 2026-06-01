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
