import type { AuditSource } from '@prisma/client'
import {
  normalizeAuditIp,
  type AuditContext,
} from '@/lib/services/audit.service'

/**
 * The client IP header to record. `x-real-ip` is set by Vercel's edge to the
 * address that connected to it and cannot be supplied by the client; the
 * first `x-forwarded-for` hop CAN be (a client may send its own header,
 * which proxies append to). So x-real-ip wins whenever it holds a valid
 * address, and the forwarded chain is only the fallback (LUM-907 PR2).
 */
export function clientIpHeader(headers: Pick<Headers, 'get'>): string | null {
  const realIp = headers.get('x-real-ip')
  if (normalizeAuditIp(realIp)) return realIp
  return headers.get('x-forwarded-for') ?? realIp
}

/**
 * LUM-907: build the audit context (who + from where) for a member-initiated
 * request. HTTP concerns stay here; the audit service validates and redacts
 * the raw IP / User-Agent before anything is stored.
 *
 * `via` is how the caller authenticated: a Clerk browser session is WEB, an
 * API-key bearer (lumo CLI, MCP, scripts) is CLI.
 */
export function memberAuditContext(
  headers: Pick<Headers, 'get'>,
  member: { clerkId?: string | null; memberId?: string | null },
  via: 'clerk' | 'bearer' = 'clerk'
): AuditContext {
  const source: AuditSource = via === 'bearer' ? 'CLI' : 'WEB'
  return {
    actor: {
      type: 'MEMBER',
      clerkId: member.clerkId ?? null,
      memberId: member.memberId ?? null,
    },
    source,
    ip: clientIpHeader(headers),
    userAgent: headers.get('user-agent'),
  }
}
