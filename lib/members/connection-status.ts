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
  | 'stale'
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
 * Judged on recently seen connections only — a stale one's versions are a
 * snapshot that may long since have been updated. Worst state wins: anything
 * behind → needsUpdate; else no connection has reported a CLI version yet →
 * unknown; else upToDate. A connection with no version next to one that has
 * reported is ignored — the CLI is installed per machine, so one report
 * stands for the member. Only stale connections → stale.
 */
export function memberVersionStatus(
  connections: MemberConnectionView[] | undefined
): MemberVersionStatus {
  if (!connections || connections.length === 0) return 'notConnected'
  const fresh = connections.filter(c => !c.stale)
  if (fresh.length === 0) return 'stale'
  if (fresh.some(connectionNeedsUpdate)) return 'needsUpdate'
  if (fresh.every(c => c.cliVersion === null)) return 'unknown'
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
 * The command that brings a connection up to date: a CLI behind the latest
 * needs `lumo update` (which also refreshes the skill); a skill behind its
 * CLI needs `lumo skill update`. An unreported CLI gets none — every current
 * CLI reports its version, so a missing one only means the connection hasn't
 * been seen since reporting started, not that it is out of date.
 */
export function connectionFixCommand(c: MemberConnectionView): string | null {
  // A stale snapshot can't tell whether anything still needs fixing.
  if (c.stale) return null
  if (c.cliBehind) return 'lumo update'
  if (c.skillBehind) return 'lumo skill update'
  return null
}

/** Setup commands for a member with no agent connection yet. */
export const CONNECT_COMMANDS: readonly string[] = [
  'npm install -g @lumoai/cli',
  'lumo init',
]
