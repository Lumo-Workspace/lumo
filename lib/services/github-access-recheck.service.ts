import { logger } from '@/lib/logger'
import { SYSTEM_AUDIT_CONTEXT } from '@/lib/services/audit.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  createInstallationToken,
  fetchInstallationRepositories,
  findAppInstallationStatus,
  checkRepositoryReadAccess,
  lookupGitHubUser,
  INSTALLATION_TOKEN_PERMISSIONS,
} from '@/lib/integrations/github'
import {
  scrubWorkspaceCode,
  scrubAfterNarrowing,
  removeInstallation,
  githubAppInstallService,
} from '@/lib/services/github-app-install.service'
import { TOKEN_FAILING_ALERT_MS } from '@/lib/services/github-access-recheck.config'

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

/**
 * LUM-927 — the removal breaker. Credentials of another App (or another
 * environment's) make every installation 404, which would read as "every
 * customer uninstalled" and unbind and scrub them all. So removals found by
 * a sweep are held when at least `BREAKER_MIN_GONE` of them make up more
 * than `BREAKER_GONE_RATIO` of the installations asked, or when no
 * installation yielded a token at all — the shape of a misconfiguration, not
 * of customers leaving. An operator confirms a held removal by id
 * (`sweep(…, { confirmRemovals })`).
 */
export const BREAKER_GONE_RATIO = 0.2
export const BREAKER_MIN_GONE = 2

/** Log prefix our alerting matches: needs a person, not just a retry. */
const OPS_ALERT = '[ops-alert]'

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
  /** Whether the result (and its `accessCheckedAt` stamp) was written. */
  recorded: boolean
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
 * a lost write race only re-scrubs. LUM-895 — once written, the removed
 * repositories are scrubbed once more, for code a scan wrote in between.
 *
 * `written` is false when nothing was written (re-verified, or still racing).
 */
async function applyRemovals(
  row: { workspaceId: string; verifiedAt: Date },
  unreadable: string[] | 'all',
  options: ApplyOptions
): Promise<{ gone: string[]; written: boolean }> {
  const reasonText =
    options.reason === 'account_gone'
      ? 'verifying GitHub account not found (automatic recheck)'
      : 'repository no longer readable by the verifier (automatic recheck)'
  const scrubbed = new Set<string>()
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const state = await githubAppInstallationRepository.findRecheckState(
      row.workspaceId
    )
    if (state?.verifiedAt?.getTime() !== row.verifiedAt.getTime()) {
      logger.info(
        `[github/access-recheck] workspace ${row.workspaceId}: re-verified during the recheck; result discarded`
      )
      return { gone: [], written: false }
    }
    const { kept, gone } = narrowConfirmed(
      state.repositories,
      unreadable === 'all' ? state.repositories : unreadable
    )
    const toScrub = gone.filter(name => !scrubbed.has(name.toLowerCase()))
    if (toScrub.length > 0) {
      await scrubWorkspaceCode(row.workspaceId, reasonText, toScrub)
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
    if (written) {
      await scrubAfterNarrowing(row.workspaceId, reasonText, gone)
      return { gone, written: true }
    }
  }
  // Still racing: nothing written; the next run asks GitHub again.
  logger.info(
    `[github/access-recheck] workspace ${row.workspaceId}: row kept changing during the recheck; result discarded`
  )
  return { gone: [], written: false }
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
    return { checked: 0, removed: [], stoppedBy: null, recorded: false }
  }
  if (verifier === 'gone') {
    // GitHub cannot find the verifying account — deleted, or suspended
    // (LUM-895: both 404). Either way nobody vouches for any of it.
    const { gone: removed, written } = await applyRemovals(row, 'all', {
      reason: 'account_gone',
      cursor: null,
      sweepPass: true,
    })
    logger.info(
      `[github/access-recheck] workspace ${row.workspaceId}: verifying GitHub account not found; removed ${removed.length} repository(ies)`
    )
    return { checked: 0, removed, stoppedBy: null, recorded: written }
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

  const { gone: removed, written } = await applyRemovals(row, unreadable, {
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
  return { checked, removed, stoppedBy, recorded: written }
}

/** LUM-927 — what a sweep learned about its installations, before acting. */
interface SweepState {
  now: () => number
  /** Installations a token (or the live list) was obtained for. */
  healthy: Set<number>
  /** Installations GitHub answered 404 / suspended for — removed at the end. */
  gone: Map<number, 'gone' | 'suspended'>
  /** Installations asked about this run, whatever the answer. */
  asked: Set<number>
  tokenFailing: number
}

/**
 * LUM-902 — an installation the sweep could not get a token for may be gone
 * on GitHub with the `deleted` webhook lost: ask GitHub. LUM-927 — its
 * answer is only recorded here; `removeGone` acts on it once the whole sweep
 * has been seen, behind the breaker. An installation GitHub still reports
 * active (a token that keeps failing — new permissions not accepted, a 422)
 * starts or continues a failure run; past `TOKEN_FAILING_ALERT_MS` it raises
 * an ops alert, and the settings card shows it. Returns whether GitHub
 * answered gone or suspended.
 */
async function onTokenFailure(
  installationId: number,
  error: unknown,
  state: SweepState
): Promise<boolean> {
  state.asked.add(installationId)
  const status = await findAppInstallationStatus(installationId)
  if (status === 'gone' || status === 'suspended') {
    state.gone.set(installationId, status)
    return true
  }
  logger.error(
    `[github/access-recheck] no token for installation ${installationId} (GitHub: ${status}); kept for the next run: ${String(error)}`
  )
  if (status !== 'active') return false
  state.tokenFailing++
  try {
    const since = await githubAppInstallationRepository.markTokenFailing(
      installationId,
      new Date(state.now())
    )
    if (state.now() - since.getTime() >= TOKEN_FAILING_ALERT_MS) {
      logger.error(
        `${OPS_ALERT} [github/access-recheck] installation ${installationId} is active on GitHub but no token could be minted since ${since.toISOString()}; its workspaces are not rechecked. Usually new App permissions await acceptance by the account owner.`
      )
    }
  } catch (stampError) {
    logger.error(
      `[github/access-recheck] installation ${installationId}: could not record the token failure: ${String(stampError)}`
    )
  }
  return false
}

/** LUM-927 — a token (or the live list) was obtained: any failure run ended. */
async function onTokenSuccess(installationId: number, state: SweepState) {
  state.asked.add(installationId)
  state.healthy.add(installationId)
  try {
    await githubAppInstallationRepository.clearTokenFailing(installationId)
  } catch (error) {
    logger.error(
      `[github/access-recheck] installation ${installationId}: could not clear the token failure: ${String(error)}`
    )
  }
}

/** LUM-927 — whether this sweep's removals look like a misconfiguration. */
export function breakerTripped(
  gone: number,
  asked: number,
  healthy: number
): boolean {
  if (gone === 0) return false
  if (healthy === 0) return true
  return gone >= BREAKER_MIN_GONE && gone > asked * BREAKER_GONE_RATIO
}

/**
 * LUM-902 — unbind and scrub every workspace of an installation GitHub no
 * longer has, like the webhook would have. LUM-927 — only when the breaker
 * holds; a tripped breaker removes nothing but the ids an operator confirmed,
 * and raises an ops alert listing the rest.
 */
async function removeGone(
  state: SweepState,
  confirmed: ReadonlySet<number>,
  summary: { uninstalled: number; failed: number; held: number[] }
) {
  const tripped = breakerTripped(
    state.gone.size,
    state.asked.size,
    state.healthy.size
  )
  if (tripped) {
    summary.held = [...state.gone.keys()].filter(id => !confirmed.has(id))
    if (summary.held.length > 0) {
      logger.error(
        `${OPS_ALERT} [github/access-recheck] removal breaker tripped: GitHub reports ${state.gone.size} of ${state.asked.size} installation(s) gone or suspended, ${state.healthy.size} healthy. Nothing unbound or scrubbed. Check the App credentials; if these really left, confirm the removal of: ${summary.held.join(', ')}`
      )
    }
  }
  for (const [installationId, status] of state.gone) {
    if (tripped && !confirmed.has(installationId)) continue
    const { removed, failed } = await removeInstallation(
      installationId,
      `${status === 'gone' ? 'uninstalled' : 'suspended'} on GitHub (automatic recheck)`,
      {
        kind: status === 'gone' ? 'deleted' : 'suspend',
        context: SYSTEM_AUDIT_CONTEXT,
      }
    )
    summary.uninstalled += removed
    summary.failed += failed
  }
}

/**
 * LUM-927 — a repository that has left the installation must leave the
 * list, and when the `installation_repositories` (or `installation`) webhook
 * failed to do it, nothing else reliably would: rows bound before LUM-882
 * have no verifier to recheck, and for the others the access recheck only
 * drops it when GitHub answers 404 about it. Narrowed like every narrowing: scrub, write (only against the row as read),
 * scrub again. Returns how many repositories left the list.
 */
async function narrowToInstallation(
  row: { workspaceId: string; repositories: string[]; updatedAt: Date },
  live: string[]
): Promise<number> {
  const { kept, gone } = narrowConfirmed(
    row.repositories,
    row.repositories.filter(
      name => !live.some(l => l.toLowerCase() === name.toLowerCase())
    )
  )
  if (gone.length === 0) return 0
  const reason = 'repository no longer in the installation (automatic recheck)'
  await scrubWorkspaceCode(row.workspaceId, reason, gone)
  const written =
    await githubAppInstallationRepository.updateRepositoriesIfUnchanged(
      row.workspaceId,
      row.updatedAt,
      kept
    )
  if (!written) return 0
  await scrubAfterNarrowing(row.workspaceId, reason, gone)
  return gone.length
}

/** LUM-895 — rotation stamp for a row that wrote no result; never throws. */
async function markAttempted(workspaceId: string) {
  try {
    await githubAppInstallationRepository.markRecheckAttempted(workspaceId)
  } catch (error) {
    logger.error(
      `[github/access-recheck] workspace ${workspaceId}: could not stamp the attempt: ${String(error)}`
    )
  }
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
   *
   * LUM-895 — every row the sweep reaches is stamped, result or not, so a
   * row that fails every day cannot hold the front of the queue.
   *
   * LUM-902 — an installation it cannot get a token for is asked about on
   * GitHub: gone or suspended there means unbound and scrubbed here.
   *
   * LUM-927 — those removals wait for the end of the sweep and the breaker
   * (`removeGone`); `confirmRemovals` lists installation ids an operator has
   * confirmed after a trip. A token that keeps failing on an installation
   * GitHub reports active is tracked and alerted on. Every row is narrowed to
   * what its installation now contains — the retry for a failed narrowing
   * webhook, and the only narrowing rows without a verifier get.
   */
  async sweep(
    now: () => number = Date.now,
    options: { confirmRemovals?: number[] } = {}
  ) {
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
      uninstalled: 0,
      /** LUM-927 — repositories dropped as no longer in the installation. */
      narrowed: 0,
      /** LUM-927 — active installations no token could be minted for. */
      tokenFailing: 0,
      /** LUM-927 — removals the breaker held, awaiting confirmation. */
      held: [] as number[],
    }
    const state: SweepState = {
      now,
      healthy: new Set(),
      gone: new Map(),
      asked: new Set(),
      tokenFailing: 0,
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
        await onTokenFailure(installationId, error, state)
        summary.skipped += group.length
        for (const row of group) await markAttempted(row.workspaceId)
        continue
      }
      await onTokenSuccess(installationId, state)
      let limited = false
      for (const row of group) {
        const { verifierLogin, verifiedAt } = row
        if (limited || !verifierLogin || !verifiedAt) {
          summary.skipped++
          continue
        }
        let recorded = false
        try {
          const outcome = await recheckRow(
            { ...row, verifierLogin, verifiedAt },
            token,
            deadline
          )
          recorded = outcome.recorded
          summary.workspaces++
          summary.checked += outcome.checked
          summary.removed += outcome.removed.length
          if (outcome.stoppedBy) summary.paused++
          if (outcome.stoppedBy === 'rate_limit') limited = true
        } catch (error) {
          summary.failed++
          logger.error(
            `[github/access-recheck] workspace ${row.workspaceId} (installation ${installationId}) failed; retried on its next turn: ${String(error)}`
          )
        }
        if (!recorded) await markAttempted(row.workspaceId)
      }
    }

    // LUM-902 — rows bound before LUM-882 have no verifier to ask about, but
    // their installation can still disappear with its webhook lost.
    // LUM-927 — and every row, verifier or not, can keep a repository that
    // left the installation when the narrowing webhook failed (the verifier
    // recheck only drops it if GitHub happens to answer 404 for it). Read
    // after the pass above, so the versions include what it wrote.
    const all =
      await githubAppInstallationRepository.findAllForInstallationNarrowing()
    const allBy = new Map<number, typeof all>()
    for (const row of all) {
      const list = allBy.get(row.installationId) ?? []
      list.push(row)
      allBy.set(row.installationId, list)
    }
    for (const [installationId, group] of allBy) {
      if (now() > deadline) break
      // Failed (or gone) above: there is no second answer to ask for.
      if (state.asked.has(installationId) && !state.healthy.has(installationId))
        continue
      let live: string[]
      try {
        live = await fetchInstallationRepositories(installationId)
      } catch (error) {
        if ((error as { code?: string }).code === 'too_many_repositories') {
          // Reached, but the list is capped: nothing to narrow against.
          await onTokenSuccess(installationId, state)
          continue
        }
        if (state.healthy.has(installationId)) {
          logger.error(
            `[github/access-recheck] installation ${installationId}: live repository list unavailable; narrowing retried next run: ${String(error)}`
          )
          continue
        }
        await onTokenFailure(installationId, error, state)
        continue
      }
      await onTokenSuccess(installationId, state)
      for (const row of group) {
        try {
          summary.narrowed += await narrowToInstallation(row, live)
        } catch (error) {
          summary.failed++
          logger.error(
            `[github/access-recheck] workspace ${row.workspaceId} (installation ${installationId}): narrowing to the installation failed; retried next run: ${String(error)}`
          )
        }
      }
    }

    summary.tokenFailing = state.tokenFailing
    await removeGone(state, new Set(options.confirmRemovals ?? []), summary)
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

    const token = await createInstallationToken(
      installationId,
      INSTALLATION_TOKEN_PERMISSIONS.collaboratorAccess
    )
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
      const { gone } = await applyRemovals(
        { workspaceId: row.workspaceId, verifiedAt },
        [repositoryFullName],
        { reason: 'access_lost', identity: verifier.identity }
      )
      removed += gone.length
    }
    return { removed }
  },

  /**
   * `repository` event from the App webhook.
   *
   * - `privatized` can take read access away from anyone who only had it
   *   because the repository was public: recheck it (LUM-882).
   * - `renamed` (LUM-879): the confirmed list and every stored `owner/name`
   *   follow the new name — otherwise the token mint is refused under the
   *   old name and the new name's events are dropped as unconfirmed.
   * - `transferred` (LUM-879): the repository has left its owner's
   *   installation. The old name is removed like an `installation_repositories`
   *   removal (GitHub does not always send one) — asking about it instead
   *   would follow GitHub's redirect to the new owner and keep it. The new
   *   name is rechecked for whoever confirmed it (LUM-882).
   * - `deleted` (LUM-879): removed the same way.
   */
  async applyRepositoryEvent(payload: RepositoryEventPayload) {
    const installationId = payload.installation?.id
    const repo = payload.repository
    if (!installationId || !repo?.full_name) return

    switch (payload.action) {
      case 'privatized':
        await this.recheckRepository(installationId, repo.full_name)
        return
      case 'renamed': {
        const fromName = payload.changes?.repository?.name?.from
        const owner = repo.full_name.slice(0, repo.full_name.indexOf('/'))
        if (!fromName || !owner) return
        await githubAppInstallService.renameRepository(
          installationId,
          `${owner}/${fromName}`,
          repo.full_name
        )
        return
      }
      case 'transferred': {
        const from =
          payload.changes?.owner?.from?.organization?.login ??
          payload.changes?.owner?.from?.user?.login
        if (from && repo.name) {
          await githubAppInstallService.removeRepository(
            [`${from}/${repo.name}`],
            'repository transferred to another owner on GitHub'
          )
        }
        await this.recheckRepository(installationId, repo.full_name)
        return
      }
      case 'deleted':
        await githubAppInstallService.removeRepository(
          [repo.full_name],
          'repository deleted on GitHub',
          installationId
        )
        return
      default:
        return
    }
  },
}

/** `repository` webhook payload, narrowed. */
export interface RepositoryEventPayload {
  action?: string
  installation?: { id?: number }
  repository?: { full_name?: string; name?: string }
  changes?: {
    /** `renamed`: the short name before the rename. */
    repository?: { name?: { from?: string } }
    owner?: {
      from?: {
        organization?: { login?: string }
        user?: { login?: string }
      }
    }
  }
}
