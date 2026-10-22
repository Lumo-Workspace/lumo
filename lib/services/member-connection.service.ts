import type { TaskArtifactAgent } from '@prisma/client'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { parseCliVersion } from '@/lib/api/cli-version-gate'
import { fetchLatestCliVersion } from '@/lib/cli/latest-version'

/**
 * LUM-1136 — the members page's "Connection" column: per member, which coding
 * agents they ran Lumo sessions from recently, with the Lumo CLI version
 * those sessions reported (hook headers).
 */

/** How far back a session still counts as a connection. */
export const CONNECTION_WINDOW_DAYS = 30

/**
 * A connection not seen for this long is "stale": its versions are a snapshot
 * from back then (the CLI is installed per machine, not per agent, so it may
 * well have been updated since). Stale connections are never judged behind.
 */
export const STALE_CONNECTION_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export interface MemberConnectionView {
  agent: TaskArtifactAgent
  /** Null when no session in the window reported it (CLI predates LUM-1136). */
  cliVersion: string | null
  lastSeenAt: string
  /** Last seen over STALE_CONNECTION_DAYS ago — versions are as of then. */
  stale: boolean
  /**
   * CLI older than the latest published CLI — or, when npm could not be
   * reached, than the newest CLI any member of the workspace reported.
   * Always false for a stale connection.
   */
  cliBehind: boolean
}

export interface ConnectionActivityRow {
  workspaceMemberId: string
  agent: TaskArtifactAgent
  lastActivityAt: Date | null
}

export interface ConnectionVersionRow {
  workspaceMemberId: string
  agent: TaskArtifactAgent
  cliVersion: string | null
}

function isOlder(a: string, b: string): boolean {
  const x = parseCliVersion(a)
  const y = parseCliVersion(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) {
    if (x[i]! !== y[i]!) return x[i]! < y[i]!
  }
  return false
}

/**
 * Merge per member × agent activity with the latest reported versions into
 * each member's connections, most recently seen first.
 */
export function buildMemberConnections(
  activity: ConnectionActivityRow[],
  versions: ConnectionVersionRow[],
  latestCliVersion: string | null,
  now: Date
): Record<string, MemberConnectionView[]> {
  const key = (memberId: string, agent: string) => `${memberId}\u0000${agent}`
  const versionByKey = new Map(
    versions.map(v => [key(v.workspaceMemberId, v.agent), v])
  )
  let newestCli: string | null = latestCliVersion
  if (!newestCli)
    for (const v of versions) {
      if (v.cliVersion && (!newestCli || isOlder(newestCli, v.cliVersion)))
        newestCli = v.cliVersion
    }

  const staleBefore = now.getTime() - STALE_CONNECTION_DAYS * DAY_MS
  const out: Record<string, MemberConnectionView[]> = {}
  for (const a of activity) {
    if (!a.lastActivityAt) continue
    const v = versionByKey.get(key(a.workspaceMemberId, a.agent))
    const cliVersion = v?.cliVersion ?? null
    const stale = a.lastActivityAt.getTime() < staleBefore
    const list = (out[a.workspaceMemberId] ??= [])
    list.push({
      agent: a.agent,
      cliVersion,
      lastSeenAt: a.lastActivityAt.toISOString(),
      stale,
      cliBehind:
        !stale && !!cliVersion && !!newestCli && isOlder(cliVersion, newestCli),
    })
  }
  for (const list of Object.values(out)) {
    list.sort((x, y) => y.lastSeenAt.localeCompare(x.lastSeenAt))
  }
  return out
}

export interface MemberConnectionsView {
  /** Keyed by WorkspaceMember id; members with no connection are absent. */
  connections: Record<string, MemberConnectionView[]>
  /** Latest published Lumo CLI version; null when npm was unreachable. */
  latestCliVersion: string | null
}

export const memberConnectionService = {
  async listConnections(
    workspaceId: string,
    now: Date
  ): Promise<MemberConnectionsView> {
    const since = new Date(now.getTime() - CONNECTION_WINDOW_DAYS * DAY_MS)
    const [activity, versions, latestCliVersion] = await Promise.all([
      sessionRepository.lastActivityByMemberAgent(workspaceId, since),
      sessionRepository.latestClientVersionsByMemberAgent(workspaceId, since),
      fetchLatestCliVersion(),
    ])
    return {
      connections: buildMemberConnections(
        activity,
        versions,
        latestCliVersion,
        now
      ),
      latestCliVersion,
    }
  },
}
