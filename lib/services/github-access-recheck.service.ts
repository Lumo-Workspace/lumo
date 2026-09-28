import { logger } from '@/lib/logger'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  createInstallationToken,
  checkRepositoryReadAccess,
  lookupGitHubUser,
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
 *
 * LUM-888 — the verifier is followed by their immutable GitHub user id, so a
 * rename keeps the list (asked under the new login) and a login someone else
 * registers later is never asked about.
 */

/** Headroom left on the installation's hourly limit for scans and webhooks. */
const RATE_RESERVE = 1000
/** Permission checks in flight per installation. */
const BATCH_SIZE = 8
/** Stop well inside the cron's maxDuration; the cursor resumes the rest. */
const SWEEP_TIME_BUDGET_MS = 240_000

/** Why the last automatic removal happened; the settings card words it. */
export type AccessRemovedReason = 'access_lost' | 'account_gone'

interface RecheckRow {
  workspaceId: string
  installationId: number
  repositories: string[]
  verifierLogin: string
  verifierGithubId: number | null
  /** The verification this recheck belongs to (LUM-888). */
  verifiedAt: Date
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

/** A concurrent webhook narrowing: re-read and retry once. */
const WRITE_ATTEMPTS = 2

interface ApplyOptions {
  reason: AccessRemovedReason
  /** `undefined` leaves a running sweep's resume point alone. */
  cursor?: string | null
  /** A sweep pass (not a webhook): stamp `accessCheckedAt` for rotation. */
  sweepPass?: boolean
  /** The verifier as GitHub knows them now, when it differs from the row. */
  identity?: { login: string; githubId: number } | undefined
}

/**
 * Apply a recheck against the row as it is *now*, not as it was when the
 * checks started: removal is by name, so a concurrent webhook narrowing is
 * not undone; any re-verification since the checks started (LUM-888: a new
 * `verifiedAt`, even from the same login) discards the result, since their
 * list wins.
 *
 * The scan code is scrubbed *before* the list narrows (LUM-888). A scrub that
 * throws writes nothing: the repository stays confirmed, so the next run asks
 * again and retries the scrub, instead of leaving code behind for a
 * repository no recheck will ever look at again. Scrubbing is idempotent, so
 * a lost write race only re-scrubs.
 */
async function applyRemovals(
  row: { workspaceId: string; verifiedAt: Date },
  unreadable: string[] | 'all',
  options: ApplyOptions
): Promise<string[]> {
  const scrubbed = new Set<string>()
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const state = await githubAppInstallationRepository.findRecheckState(
      row.workspaceId
    )
    if (state?.verifiedAt?.getTime() !== row.verifiedAt.getTime()) {
      logger.info(
        `[github/access-recheck] workspace ${row.workspaceId}: re-verified during the recheck; result discarded`
      )
      return []
    }
    const { kept, gone } = narrowConfirmed(
      state.repositories,
      unreadable === 'all' ? state.repositories : unreadable
    )
    const toScrub = gone.filter(name => !scrubbed.has(name.toLowerCase()))
    if (toScrub.length > 0) {
      await scrubWorkspaceCode(
        row.workspaceId,
        options.reason === 'account_gone'
          ? 'verifying GitHub account no longer exists (automatic recheck)'
          : 'repository no longer readable by the verifier (automatic recheck)',
        toScrub
      )
      toScrub.forEach(name => scrubbed.add(name.toLowerCase()))
    }
    const written =
      await githubAppInstallationRepository.updateRecheckIfUnchanged(
        row.workspaceId,
        { verifiedAt: row.verifiedAt, updatedAt: state.updatedAt },
        {
          repositories: kept,
          ...(options.cursor !== undefined && {
            accessCheckCursor: options.cursor,
          }),
          ...(options.sweepPass && { accessCheckedAt: new Date() }),
          ...(options.identity && {
            verifierLogin: options.identity.login,
            verifierGithubId: options.identity.githubId,
          }),
          ...(gone.length > 0 && {
            accessRemovedCount: state.accessRemovedCount + gone.length,
            accessRemovedAt: new Date(),
            accessRemovedReason: options.reason,
          }),
        }
      )
    if (written) return gone
  }
  // Still racing: nothing written; the next run asks GitHub again.
  logger.info(
    `[github/access-recheck] workspace ${row.workspaceId}: row kept changing during the recheck; result discarded`
  )
  return []
}

/**
 * The verifier as GitHub knows them now: by id when recorded, else by the
 * stored login (rows verified before LUM-888). `identity` is set when the
 * row should be updated — a rename, or an id recorded for the first time.
 */
async function resolveVerifier(
  token: string,
  row: Pick<RecheckRow, 'verifierLogin' | 'verifierGithubId'>
): Promise<
  | { login: string; identity?: { login: string; githubId: number } }
  | 'gone'
  | null
> {
  const user = await lookupGitHubUser(
    token,
    row.verifierGithubId !== null
      ? { id: row.verifierGithubId }
      : { login: row.verifierLogin }
  )
  if (user === null || user === 'gone') return user
  const changed =
    user.login !== row.verifierLogin || user.id !== row.verifierGithubId
  return {
    login: user.login,
    ...(changed && { identity: { login: user.login, githubId: user.id } }),
  }
}

/**
 * One workspace's pass over its confirmed list, resuming after the stored
 * cursor. Checks run in small batches; the cursor only ever advances past a
 * batch that fully completed, so a batch cut by the rate limit is re-asked.
 */
async function recheckRow(
  row: RecheckRow,
  token: string,
  deadline: number
): Promise<RowOutcome> {
  const verifier = await resolveVerifier(token, row)
  if (verifier === null) {
    return { checked: 0, removed: [], stoppedBy: null }
  }
  if (verifier === 'gone') {
    // The verifying account no longer exists: nobody vouches for any of it.
    const removed = await applyRemovals(row, 'all', {
      reason: 'account_gone',
      cursor: null,
      sweepPass: true,
    })
    logger.info(
      `[github/access-recheck] workspace ${row.workspaceId}: verifying GitHub account no longer exists; removed ${removed.length} repository(ies)`
    )
    return { checked: 0, removed, stoppedBy: null }
  }
  const login = verifier.login

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

  const removed = await applyRemovals(row, unreadable, {
    reason: 'access_lost',
    cursor: stoppedBy ? lastDone : null,
    sweepPass: true,
    identity: verifier.identity,
  })
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
   *
   * LUM-888 — rows come longest-waiting first, so when the time budget runs
   * out it is the most recently checked installations that wait, and every
   * installation takes its turn. One row or installation failing (a scrub
   * that throws, GitHub erroring) is logged and the sweep moves on.
   */
  async sweep(now: () => number = Date.now) {
    const deadline = now() + SWEEP_TIME_BUDGET_MS
    const rows = await githubAppInstallationRepository.findAllWithVerifier()

    // Map keeps first-seen order: installations run longest-waiting first.
    const byInstallation = new Map<number, typeof rows>()
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
      failed: 0,
    }

    for (const [installationId, group] of byInstallation) {
      if (now() > deadline) {
        summary.skipped += group.length
        continue
      }
      let token: string
      try {
        token = await createInstallationToken(installationId)
      } catch (error) {
        logger.error(
          `[github/access-recheck] no token for installation ${installationId}: ${String(error)}`
        )
        summary.skipped += group.length
        continue
      }
      let limited = false
      for (const row of group) {
        const { verifierLogin, verifiedAt } = row
        if (limited || !verifierLogin || !verifiedAt) {
          summary.skipped++
          continue
        }
        try {
          const outcome = await recheckRow(
            { ...row, verifierLogin, verifiedAt },
            token,
            deadline
          )
          summary.workspaces++
          summary.checked += outcome.checked
          summary.removed += outcome.removed.length
          if (outcome.stoppedBy) summary.paused++
          if (outcome.stoppedBy === 'rate_limit') limited = true
        } catch (error) {
          summary.failed++
          logger.error(
            `[github/access-recheck] workspace ${row.workspaceId} (installation ${installationId}) failed; the next run retries: ${String(error)}`
          )
        }
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
        row.verifiedAt &&
        row.repositories.some(name => name.toLowerCase() === target)
    )
    if (affected.length === 0) return { removed: 0 }

    const token = await createInstallationToken(installationId)
    let removed = 0
    for (const row of affected) {
      const verifiedAt = row.verifiedAt as Date
      // Ask about who the verifier is now: a stale login after a rename
      // would 404 (or name someone else). Unknown / gone → the daily sweep.
      const verifier = await resolveVerifier(token, {
        verifierLogin: row.verifierLogin as string,
        verifierGithubId: row.verifierGithubId,
      })
      if (verifier === null || verifier === 'gone') continue
      const { access } = await checkRepositoryReadAccess(
        token,
        repositoryFullName,
        verifier.login
      )
      if (access !== 'unreadable') continue
      const gone = await applyRemovals(
        { workspaceId: row.workspaceId, verifiedAt },
        [repositoryFullName],
        { reason: 'access_lost', identity: verifier.identity }
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
