import { logger } from '@/lib/logger'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  createInstallationToken,
  checkRepositoryReadAccess,
  checkUserExists,
  INSTALLATION_TOKEN_PERMISSIONS,
} from '@/lib/integrations/github'
import { scrubWorkspaceCode } from '@/lib/services/github-app-install.service'

/**
 * LUM-882 — keep a workspace's confirmed GitHub repositories in step with what
 * its verifier (whoever last bound or re-verified the installation) can read
 * on GitHub *now*, without holding any user credential (LUM-875): the question
 * is asked with the installation token, about the verifier's login.
 *
 * A repository the verifier can no longer read leaves the confirmed list and
 * has its scan code scrubbed, exactly like a manual re-verification that finds
 * it unreadable. Fail closed on GitHub's answers (`none`, 404, deleted
 * account); fail safe on GitHub failing to answer (5xx, network, rate limit):
 * those keep the repository and the next run asks again.
 */

/** Headroom left on the installation's hourly limit for scans and webhooks. */
const RATE_RESERVE = 1000
/** Permission checks in flight per installation. */
const BATCH_SIZE = 8
/** Stop well inside the cron's maxDuration; the cursor resumes the rest. */
const SWEEP_TIME_BUDGET_MS = 240_000

interface RecheckRow {
  workspaceId: string
  installationId: number
  repositories: string[]
  verifierLogin: string | null
  accessCheckCursor: string | null
}

interface RowOutcome {
  checked: number
  removed: string[]
  /** Set when the run stopped before the end of the list. */
  stoppedBy: 'rate_limit' | 'time' | null
}

const byName = (a: string, b: string) =>
  a.toLowerCase().localeCompare(b.toLowerCase())

/**
 * Split the current confirmed list by a recheck's unreadable names. GitHub
 * repository names are case-insensitive; `gone` keeps the stored spelling so
 * the scrub matches the scan rows.
 */
export function narrowConfirmed(
  current: string[],
  unreadable: string[]
): { kept: string[]; gone: string[] } {
  const drop = new Set(unreadable.map(name => name.toLowerCase()))
  return {
    kept: current.filter(name => !drop.has(name.toLowerCase())),
    gone: current.filter(name => drop.has(name.toLowerCase())),
  }
}

/** A concurrent webhook narrowing or re-verification: re-read and retry once. */
const WRITE_ATTEMPTS = 2

/**
 * Apply a recheck against the row as it is *now*, not as it was when the
 * checks started: removal is by name, so a concurrent webhook narrowing is
 * not undone; a changed verifier (an owner re-verified mid-run) discards the
 * result, since their list wins. `cursor === undefined` leaves a running
 * sweep's resume point alone.
 */
async function applyRemovals(
  row: { workspaceId: string; verifierLogin: string },
  unreadable: string[],
  cursor?: string | null
): Promise<string[]> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const state = await githubAppInstallationRepository.findRecheckState(
      row.workspaceId
    )
    if (!state || state.verifierLogin !== row.verifierLogin) {
      logger.info(
        `[github/access-recheck] workspace ${row.workspaceId}: verifier changed during the recheck; result discarded`
      )
      return []
    }
    const { kept, gone } = narrowConfirmed(state.repositories, unreadable)
    const written =
      await githubAppInstallationRepository.updateRecheckIfUnchanged(
        row.workspaceId,
        { verifierLogin: row.verifierLogin, updatedAt: state.updatedAt },
        {
          repositories: kept,
          ...(cursor !== undefined && { accessCheckCursor: cursor }),
          ...(gone.length > 0 && {
            accessRemovedCount: state.accessRemovedCount + gone.length,
            accessRemovedAt: new Date(),
          }),
        }
      )
    if (!written) continue
    if (gone.length > 0) {
      await scrubWorkspaceCode(
        row.workspaceId,
        'repository no longer readable by the verifier (automatic recheck)',
        gone
      )
    }
    return gone
  }
  // Still racing: nothing written; the next run asks GitHub again.
  logger.info(
    `[github/access-recheck] workspace ${row.workspaceId}: row kept changing during the recheck; result discarded`
  )
  return []
}

/**
 * One workspace's pass over its confirmed list, resuming after the stored
 * cursor. Checks run in small batches; the cursor only ever advances past a
 * batch that fully completed, so a batch cut by the rate limit is re-asked.
 */
async function recheckRow(
  row: RecheckRow & { verifierLogin: string },
  token: string,
  deadline: number
): Promise<RowOutcome> {
  const login = row.verifierLogin

  const exists = await checkUserExists(token, login)
  if (exists === null) {
    return { checked: 0, removed: [], stoppedBy: null }
  }
  if (exists === false) {
    // Deleted or renamed account: nobody vouches for any of it any more.
    const removed = await applyRemovals(
      { workspaceId: row.workspaceId, verifierLogin: login },
      row.repositories,
      null
    )
    logger.info(
      `[github/access-recheck] workspace ${row.workspaceId}: verifier ${login} no longer exists on GitHub; removed ${removed.length} repository(ies)`
    )
    return { checked: 0, removed, stoppedBy: null }
  }

  const ordered = [...row.repositories].sort(byName)
  const cursor = row.accessCheckCursor
  const start = cursor ? ordered.findIndex(name => byName(name, cursor) > 0) : 0
  const pending = start === -1 ? [] : ordered.slice(start)

  const unreadable: string[] = []
  let lastDone: string | null = cursor
  let checked = 0
  let stoppedBy: RowOutcome['stoppedBy'] = null

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (Date.now() > deadline) {
      stoppedBy = 'time'
      break
    }
    const batch = pending.slice(i, i + BATCH_SIZE)
    const answers = await Promise.all(
      batch.map(name => checkRepositoryReadAccess(token, name, login))
    )
    if (answers.some(a => a.access === 'rate_limited')) {
      stoppedBy = 'rate_limit'
      break
    }
    batch.forEach((name, j) => {
      if (answers[j]?.access === 'unreadable') unreadable.push(name)
    })
    checked += batch.length
    lastDone = batch[batch.length - 1] ?? lastDone
    const lowest = Math.min(
      ...answers.map(a => a.remaining ?? Number.POSITIVE_INFINITY)
    )
    if (lowest < RATE_RESERVE && i + BATCH_SIZE < pending.length) {
      stoppedBy = 'rate_limit'
      break
    }
  }

  const removed = await applyRemovals(
    { workspaceId: row.workspaceId, verifierLogin: login },
    unreadable,
    stoppedBy ? lastDone : null
  )
  if (removed.length > 0 || stoppedBy) {
    logger.info(
      `[github/access-recheck] workspace ${row.workspaceId}: checked ${checked}, removed ${removed.length}${stoppedBy ? `, paused (${stoppedBy})` : ''}`
    )
  }
  return { checked, removed, stoppedBy }
}

export const githubAccessRecheckService = {
  /**
   * Daily sweep (cron). Installations bound before LUM-882 have no verifier
   * login and are skipped — the settings card asks an owner to re-verify once.
   * Rows sharing an installation (LUM-872) share its token and rate limit, so
   * once one of them hits the limit the rest wait for the next run.
   */
  async sweep(now: () => number = Date.now) {
    const deadline = now() + SWEEP_TIME_BUDGET_MS
    const rows = await githubAppInstallationRepository.findAllWithVerifier()

    const byInstallation = new Map<number, RecheckRow[]>()
    for (const row of rows) {
      const list = byInstallation.get(row.installationId) ?? []
      list.push(row)
      byInstallation.set(row.installationId, list)
    }

    const summary = {
      workspaces: 0,
      checked: 0,
      removed: 0,
      paused: 0,
      skipped: 0,
    }

    for (const [installationId, group] of byInstallation) {
      if (now() > deadline) {
        summary.skipped += group.length
        continue
      }
      let token: string
      try {
        token = await createInstallationToken(
          installationId,
          INSTALLATION_TOKEN_PERMISSIONS.collaboratorAccess
        )
      } catch (error) {
        logger.error(
          `[github/access-recheck] no token for installation ${installationId}: ${String(error)}`
        )
        summary.skipped += group.length
        continue
      }
      let limited = false
      for (const row of group) {
        if (limited || !row.verifierLogin) {
          summary.skipped++
          continue
        }
        const outcome = await recheckRow(
          { ...row, verifierLogin: row.verifierLogin },
          token,
          deadline
        )
        summary.workspaces++
        summary.checked += outcome.checked
        summary.removed += outcome.removed.length
        if (outcome.stoppedBy) summary.paused++
        if (outcome.stoppedBy === 'rate_limit') limited = true
      }
    }
    return summary
  },

  /**
   * Targeted recheck of one repository in every workspace bound to the
   * installation (the `repository` webhook: privatized / transferred).
   * Workspaces without a verifier login, or without this repository
   * confirmed, are left alone.
   */
  async recheckRepository(installationId: number, repositoryFullName: string) {
    const target = repositoryFullName.toLowerCase()
    const rows =
      await githubAppInstallationRepository.findAllByInstallationId(
        installationId
      )
    const affected = rows.filter(
      row =>
        row.verifierLogin &&
        row.repositories.some(name => name.toLowerCase() === target)
    )
    if (affected.length === 0) return { removed: 0 }

    const token = await createInstallationToken(
      installationId,
      INSTALLATION_TOKEN_PERMISSIONS.collaboratorAccess
    )
    let removed = 0
    for (const row of affected) {
      const login = row.verifierLogin as string
      const { access } = await checkRepositoryReadAccess(
        token,
        repositoryFullName,
        login
      )
      if (access !== 'unreadable') continue
      const gone = await applyRemovals(
        { workspaceId: row.workspaceId, verifierLogin: login },
        [repositoryFullName]
      )
      removed += gone.length
    }
    return { removed }
  },

  /**
   * `repository` event from the App webhook. `privatized` can take read
   * access away from anyone who only had it because the repository was
   * public; `transferred` moves it to another owner, so the name on the
   * confirmed list is the old one.
   */
  async applyRepositoryEvent(payload: RepositoryEventPayload) {
    const installationId = payload.installation?.id
    const repo = payload.repository
    if (!installationId || !repo?.full_name) return

    if (payload.action === 'privatized') {
      await this.recheckRepository(installationId, repo.full_name)
      return
    }
    if (payload.action === 'transferred') {
      const from =
        payload.changes?.owner?.from?.organization?.login ??
        payload.changes?.owner?.from?.user?.login
      const names = [repo.full_name]
      if (from && repo.name) names.push(`${from}/${repo.name}`)
      for (const name of names) {
        await this.recheckRepository(installationId, name)
      }
    }
  },
}

/** `repository` webhook payload, narrowed. */
export interface RepositoryEventPayload {
  action?: string
  installation?: { id?: number }
  repository?: { full_name?: string; name?: string }
  changes?: {
    owner?: {
      from?: {
        organization?: { login?: string }
        user?: { login?: string }
      }
    }
  }
}
