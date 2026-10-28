import { logger } from '@/lib/logger'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { GITHUB_PROVIDER } from '@/lib/integrations/git-provider'
import { gitProviderFor } from '@/lib/integrations/git-provider/resolve'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

/**
 * LUM-896 — the confirmed-list check on a scan's token happens when the token
 * is minted; the scan writes its result later. A repository that leaves the
 * workspace's confirmed list in between would keep the code that result
 * carries: every narrowing path scrubs before and after it writes the list,
 * but a scan landing after that second scrub is never looked at again.
 *
 * So each scan write that can carry code is followed by this recheck: read
 * the list as it is *now* and, when the scan's repository is no longer on it
 * (or the App is gone), scrub that scan. Ordering closes the gap: a narrowing
 * that commits before this read is seen here; one that commits after it is
 * followed by its own after-narrowing scrub, which sees this scan's rows.
 *
 * Best effort: the write it follows has already landed, and failing it (a
 * workflow step retrying a hunt write, stage A marking the scan FAILED)
 * would cost more than the scrub it retries. The failure is logged.
 */
export async function scrubScanIfRepositoryUnconfirmed(
  scanId: string
): Promise<boolean> {
  try {
    const scope = await prSecurityScanRepository.findScanRepository(scanId)
    if (!scope) return false
    // LUM-1318: the scan's own platform decides what "confirmed" means.
    const git = gitProviderFor(scope)
    const confirmed = await git.findConfirmedRepositories(scope.workspaceId)
    if (confirmed && git.isConfirmedRepository(confirmed, scope.repo))
      return false
    const counts = await prSecurityScanRepository.scrubCodeForScan(scanId)
    logger.info(
      `[security-scan] scan ${scanId}: repository no longer confirmed for workspace ${scope.workspaceId}; scrubbed code from ${counts.findings} finding(s)`
    )
    return true
  } catch (error) {
    logger.error(
      `[security-scan] scan ${scanId}: confirmed-list recheck failed: ${String(error)}`
    )
    return false
  }
}

/**
 * LUM-902 — the backstop behind every narrowing and behind the LUM-896
 * recheck above, both of which are best effort: a scan written in the
 * millisecond window before the recheck, a stage A that crashed in its HTTP
 * worker, a second scrub that failed and was only logged. Each leaves code
 * for a repository no confirmed list names — which no daily access recheck
 * looks at again.
 *
 * So once a day: every repository still holding scan code is compared with
 * its workspace's confirmed list (case-insensitively), and the code of those
 * not on it — or of every repository, when the workspace has no App — is
 * scrubbed. Scan and finding rows stay, as with every scrub. One workspace
 * failing is logged and the sweep moves on; the next run retries it.
 */
export async function sweepUnconfirmedScanCode(): Promise<{
  workspaces: number
  repositories: number
  failed: number
}> {
  const held = await prSecurityScanRepository.findRepositoriesHoldingCode()
  const byWorkspace = new Map<string, string[]>()
  // LUM-1316: another platform's repositories are checked against that
  // platform's own confirmed list (below), never GitHub's.
  const elsewhere = new Map<string, string[]>()
  for (const { workspaceId, repo, provider } of held) {
    if (provider !== undefined && provider !== GITHUB_PROVIDER) {
      const key = `${provider}\u0000${workspaceId}`
      elsewhere.set(key, [...(elsewhere.get(key) ?? []), repo])
      continue
    }
    byWorkspace.set(workspaceId, [
      ...(byWorkspace.get(workspaceId) ?? []),
      repo,
    ])
  }
  const lists = new Map(
    (
      await githubAppInstallationRepository.findConfirmedLists([
        ...byWorkspace.keys(),
      ])
    ).map(row => [row.workspaceId, row.repositories])
  )

  // The confirmed lists above are the GitHub App installations' (this sweep
  // backstops the GitHub repository lifecycle), so GitHub's matching rules.
  const github = gitProviderFor({ provider: GITHUB_PROVIDER })
  const summary = { workspaces: 0, repositories: 0, failed: 0 }
  for (const [workspaceId, repos] of byWorkspace) {
    const confirmed = lists.get(workspaceId) ?? []
    const stray = repos.filter(
      repo => !github.isConfirmedRepository(confirmed, repo)
    )
    if (stray.length === 0) continue
    try {
      const counts = await prSecurityScanRepository.scrubCodeForWorkspace(
        workspaceId,
        stray
      )
      summary.workspaces++
      summary.repositories += stray.length
      logger.info(
        `[security-scan] backstop: workspace ${workspaceId}: ${stray.length} repository(ies) not confirmed; scrubbed code from ${counts.scans} scan(s), ${counts.findings} finding(s)`
      )
    } catch (error) {
      summary.failed++
      logger.error(
        `[security-scan] backstop: workspace ${workspaceId} scrub failed; retried next run: ${String(error)}`
      )
    }
  }
  for (const [key, repos] of elsewhere) {
    const [provider = '', workspaceId = ''] = key.split('\u0000')
    try {
      const git = gitProviderFor({ provider })
      const confirmed = (await git.findConfirmedRepositories(workspaceId)) ?? []
      const stray = repos.filter(
        repo => !git.isConfirmedRepository(confirmed, repo)
      )
      if (stray.length === 0) continue
      const counts = await prSecurityScanRepository.scrubCodeForWorkspace(
        workspaceId,
        stray,
        provider
      )
      summary.workspaces++
      summary.repositories += stray.length
      logger.info(
        `[security-scan] backstop: workspace ${workspaceId} (${provider}): ${stray.length} repository(ies) not confirmed; scrubbed code from ${counts.scans} scan(s), ${counts.findings} finding(s)`
      )
    } catch (error) {
      summary.failed++
      logger.error(
        `[security-scan] backstop: workspace ${workspaceId} (${provider}) scrub failed; retried next run: ${String(error)}`
      )
    }
  }
  return summary
}
