/**
 * LUM-1136 (members page redesign) — pure derivations over a member's agent
 * connections: the one-line version status, the filter tabs, the update
 * banner count and the command that fixes a stale connection.
 */
import type { MemberConnectionView } from '@/lib/services/member-connection.service'

export type MemberVersionStatus =
  | 'needsUpdate'
  | 'unknown'
  | 'upToDate'
  | 'notConnected'

export type MemberFilter = 'all' | 'needsUpdate' | 'notConnected'

export const MEMBER_FILTERS: readonly MemberFilter[] = [
  'all',
  'needsUpdate',
  'notConnected',
]

export function connectionNeedsUpdate(c: MemberConnectionView): boolean {
  return c.cliBehind || c.skillBehind
}

/**
 * Worst state wins: anything behind → needsUpdate; else any connection whose
 * CLI reported no version (predates LUM-1136) → unknown; else upToDate.
 */
export function memberVersionStatus(
  connections: MemberConnectionView[] | undefined
): MemberVersionStatus {
  if (!connections || connections.length === 0) return 'notConnected'
  if (connections.some(connectionNeedsUpdate)) return 'needsUpdate'
  if (connections.some(c => c.cliVersion === null)) return 'unknown'
  return 'upToDate'
}

export function matchesMemberFilter(
  status: MemberVersionStatus,
  filter: MemberFilter
): boolean {
  if (filter === 'all') return true
  return status === filter
}

/** Case-insensitive substring match on name or email; blank matches all. */
export function matchesMemberQuery(
  member: { name: string; email: string | null },
  query: string
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    member.name.toLowerCase().includes(q) ||
    (member.email ?? '').toLowerCase().includes(q)
  )
}

/** Connections across the workspace that need an update (banner count). */
export function countConnectionsNeedingUpdate(
  byMember: Record<string, MemberConnectionView[]>
): number {
  let n = 0
  for (const list of Object.values(byMember)) {
    n += list.filter(connectionNeedsUpdate).length
  }
  return n
}

/**
 * The command that brings a connection up to date: an old or unreported CLI
 * needs `lumo update` (which also refreshes the skill); a skill behind its
 * CLI needs `lumo skill update`.
 */
export function connectionFixCommand(c: MemberConnectionView): string | null {
  if (c.cliBehind || c.cliVersion === null) return 'lumo update'
  if (c.skillBehind) return 'lumo skill update'
  return null
}

/** Setup commands for a member with no agent connection yet. */
export const CONNECT_COMMANDS: readonly string[] = [
  'npm install -g @lumoai/cli',
  'lumo init',
]
