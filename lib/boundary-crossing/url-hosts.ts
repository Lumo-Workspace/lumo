/**
 * LUM-1114 — is an upload's destination the public internet?
 *
 * EXFILTRATION_PUBLIC is about local data leaving for the public internet. A
 * coding agent POSTs fixtures to its own dev server (`curl -d @body.json
 * http://localhost:3000/api/…`) all the time; that is not exfiltration. Pure.
 *
 * Narrow on purpose (the category is irreversible): only a LITERAL host that is
 * loopback, an RFC 1918 private range, or a reserved local name counts as
 * non-public. A host built from a variable (`http://$HOST`) or with no literal
 * URL at all stays public — no evidence, no exemption. Link-local 169.254/16
 * (cloud metadata) and the documentation ranges (192.0.2/24 …) are NOT exempt.
 */

const URL_PATTERN = /https?:\/\/([^/\s'"?#)]+)/gi

/** The authority of each literal http(s) URL in `text` (userinfo stripped). */
export function literalUrlHosts(text: string): string[] {
  const hosts: string[] = []
  for (const m of text.matchAll(URL_PATTERN)) {
    const authority = m[1] ?? ''
    hosts.push(authority.slice(authority.lastIndexOf('@') + 1))
  }
  return hosts
}

function stripPort(authority: string): string {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end === -1 ? authority : authority.slice(1, end)
  }
  const colon = authority.lastIndexOf(':')
  return colon === -1 ? authority : authority.slice(0, colon)
}

function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  // Plain decimal only: a leading zero (`010`) is octal to curl and the C
  // resolver (`010.0.0.1` is 8.0.0.1), so it is not read as decimal here —
  // the host stays public.
  const octets = parts.map(p =>
    /^(?:0|[1-9]\d{0,2})$/.test(p) ? Number(p) : NaN
  )
  return octets.every(o => o >= 0 && o <= 255) ? octets : null
}

/** Loopback, RFC 1918 private, or a reserved local name. */
export function isNonPublicHost(authority: string): boolean {
  const host = stripPort(authority).toLowerCase().replace(/\.$/, '')
  if (!host || /[^a-z0-9.\-:]/.test(host)) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.test')) return true
  if (host === '::1' || host === '0.0.0.0') return true
  const o = ipv4Octets(host)
  if (!o) return false
  const [a, b] = o as [number, number, number, number]
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * True when `segment` names at least one literal URL and every literal URL in
 * the whole `command` is non-public — the only case an upload is exempt.
 */
export function uploadStaysLocal(segment: string, command: string): boolean {
  if (literalUrlHosts(segment).length === 0) return false
  return literalUrlHosts(command).every(isNonPublicHost)
}
