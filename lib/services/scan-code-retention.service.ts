import { logger } from '@/lib/logger'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { isConfirmedRepository } from '@/lib/integrations/github/confirmed-repositories'

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
    const installation = await githubAppInstallationRepository.findByWorkspace(
      scope.workspaceId
    )
    if (
      installation &&
      isConfirmedRepository(installation.repositories, scope.repo)
    )
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
