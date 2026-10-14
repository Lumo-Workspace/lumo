import type { TaskArtifactAgent } from '@prisma/client'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { parseCliVersion } from '@/lib/api/cli-version-gate'
import { fetchLatestCliVersion } from '@/lib/cli/latest-version'

/**
 * LUM-1136 — the members page's "Connection" column: per member, which coding
 * agents they ran Lumo sessions from recently, with the Lumo CLI and skill
 * versions those sessions reported (SessionStart hook headers).
 */

/** How far back a session still counts as a connection. */
export const CONNECTION_WINDOW_DAYS = 30

export interface MemberConnectionView {
  agent: TaskArtifactAgent
  /** Null when no session in the window reported it (CLI predates LUM-1136). */
  cliVersion: string | null
  /** `1.2.3`, `1.2.3 modified`, `modified`, `source`, `none`, or null (unknown). */
  skillVersion: string | null
  lastSeenAt: string
  /**
   * CLI older than the latest published CLI — or, when npm could not be
   * reached, than the newest CLI any member of the workspace reported.
   */
  cliBehind: boolean
  /** Managed skill copy older than the CLI it runs with (`lumo skill update`). */
  skillBehind: boolean
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
  skillVersion: string | null
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

/** Only a plain managed version (`1.2.3`) can be behind; modified / source / none never are. */
function skillIsBehind(skill: string | null, cli: string | null): boolean {
  if (!skill || !cli || !parseCliVersion(skill)) return false
  return isOlder(skill, cli)
}

/**
 * Merge per member × agent activity with the latest reported versions into
 * each member's connections, most recently seen first.
 */
export function buildMemberConnections(
  activity: ConnectionActivityRow[],
  versions: ConnectionVersionRow[],
  latestCliVersion: string | null = null
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

  const out: Record<string, MemberConnectionView[]> = {}
  for (const a of activity) {
    if (!a.lastActivityAt) continue
    const v = versionByKey.get(key(a.workspaceMemberId, a.agent))
    const cliVersion = v?.cliVersion ?? null
    const skillVersion = v?.skillVersion ?? null
    const list = (out[a.workspaceMemberId] ??= [])
    list.push({
      agent: a.agent,
      cliVersion,
      skillVersion,
      lastSeenAt: a.lastActivityAt.toISOString(),
      cliBehind: !!cliVersion && !!newestCli && isOlder(cliVersion, newestCli),
      skillBehind: skillIsBehind(skillVersion, cliVersion),
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
  /** Latest published Lumo CLI (= skill) version; null when npm was unreachable. */
  latestCliVersion: string | null
}

export const memberConnectionService = {
  async listConnections(
    workspaceId: string,
    now: Date
  ): Promise<MemberConnectionsView> {
    const since = new Date(
      now.getTime() - CONNECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
    )
    const [activity, versions, latestCliVersion] = await Promise.all([
      sessionRepository.lastActivityByMemberAgent(workspaceId, since),
      sessionRepository.latestClientVersionsByMemberAgent(workspaceId, since),
      fetchLatestCliVersion(),
    ])
    return {
      connections: buildMemberConnections(activity, versions, latestCliVersion),
      latestCliVersion,
    }
  },
}
