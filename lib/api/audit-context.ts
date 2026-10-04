import type { AuditSource } from '@prisma/client'
import type { AuditContext } from '@/lib/services/audit.service'

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
    ip: headers.get('x-forwarded-for') ?? headers.get('x-real-ip'),
    userAgent: headers.get('user-agent'),
  }
}
