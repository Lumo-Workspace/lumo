import { lookup } from 'dns/promises'
import net from 'net'

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some(p => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    throw new Error(`invalid IPv4: ${ip}`)
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  )
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  // Use >>> 0 on both sides to ensure unsigned 32-bit comparison;
  // JavaScript bitwise ops produce signed int32, which breaks comparisons
  // for addresses with the high bit set (128.x.x.x and above).

  // 0.0.0.0/8
  if ((n & 0xff000000) >>> 0 === 0x00000000 >>> 0) return true
  // 10.0.0.0/8
  if ((n & 0xff000000) >>> 0 === 0x0a000000 >>> 0) return true
  // 127.0.0.0/8
  if ((n & 0xff000000) >>> 0 === 0x7f000000 >>> 0) return true
  // 169.254.0.0/16
  if ((n & 0xffff0000) >>> 0 === 0xa9fe0000 >>> 0) return true
  // 172.16.0.0/12
  if ((n & 0xfff00000) >>> 0 === 0xac100000 >>> 0) return true
  // 192.168.0.0/16
  if ((n & 0xffff0000) >>> 0 === 0xc0a80000 >>> 0) return true
  // 224.0.0.0/4 (multicast)
  if ((n & 0xf0000000) >>> 0 === 0xe0000000 >>> 0) return true
  // 240.0.0.0/4 (reserved)
  if ((n & 0xf0000000) >>> 0 === 0xf0000000 >>> 0) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  // IPv4-mapped IPv6: ::ffff:a.b.c.d — re-check against IPv4 rules.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return isPrivateIPv4(mapped[1])

  // Also normalize shortened ::ffff:HHHH:HHHH that browsers can emit.
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16)
    const lo = parseInt(hexMapped[2], 16)
    const dotted = [
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >> 8) & 0xff,
      lo & 0xff,
    ].join('.')
    return isPrivateIPv4(dotted)
  }

  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  if (lower === '::') return true
  // fe80::/10 — link-local
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  )
    return true
  // fc00::/7 — unique-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  // ff00::/8 — multicast
  if (lower.startsWith('ff')) return true
  return false
}

/**
 * Throws if the URL's hostname resolves to ANY private/loopback/link-local
 * address (IPv4 or IPv6). Call before every outbound fetch.
 */
export async function assertExternalHost(rawUrl: string): Promise<void> {
  const u = new URL(rawUrl) // throws on malformed; caller's problem
  const host = u.hostname

  // Reject literal IP hostnames in private ranges before DNS even runs.
  const literalFamily = net.isIP(host)
  if (literalFamily === 4 && isPrivateIPv4(host)) {
    throw new Error('host not allowed (private IPv4 literal)')
  }
  if (literalFamily === 6 && isPrivateIPv6(host)) {
    throw new Error('host not allowed (private IPv6 literal)')
  }
  if (literalFamily !== 0) return

  const records = await lookup(host, { all: true })
  for (const r of records) {
    const bad =
      r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address)
    if (bad) {
      throw new Error(`host not allowed (resolved to ${r.address})`)
    }
  }
}
