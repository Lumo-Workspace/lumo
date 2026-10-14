import { NextRequest, NextResponse } from 'next/server'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import {
  handlePullRequest,
  handleCheckSuite,
  handlePush,
  handleIssueComment,
  handlePullRequestReview,
  handlePullRequestReviewComment,
  handlePullRequestReviewThread,
} from './handlers'
import { githubService } from '@/lib/services/github.service'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { githubAccessRecheckService } from '@/lib/services/github-access-recheck.service'
import { logger } from '@/lib/logger'

/** Events delivered by the App-level webhook rather than the OAuth repo hook. */
const APP_EVENTS = new Set([
  'installation',
  'installation_repositories',
  // LUM-882 — privatized triggers a verifier access recheck; LUM-879 —
  // renamed follows the new name, transferred / deleted remove the old one.
  // The OAuth repo hooks never subscribe to it, so it only arrives here.
  'repository',
])

/**
 * LUM-1127 — repository events only the App webhook delivers (the OAuth repo
 * hook's event list, `createRepoWebhook`, does not include them).
 */
const APP_ONLY_REPO_EVENTS = new Set(['pull_request_review_thread'])

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub webhook events over two independent deliveries that share
 * this endpoint:
 *
 * - **Repo hooks** created by the OAuth connection (pull_request, push,
 *   check_suite, status, comments, reviews). The workspace comes from
 *   `repository.full_name` and the signature is checked against that
 *   integration's own `webhookSecret`. Only repositories in the workspace's
 *   confirmed App list are handled (LUM-884).
 * - **The App-level webhook** (`installation`, `installation_repositories`).
 *   These payloads carry no repository at all, so neither the lookup nor the
 *   secret above applies: they are verified against GITHUB_APP_WEBHOOK_SECRET
 *   and attributed by `installation.id` (LUM-616 confirmed both hooks coexist).
 */
export async function POST(request: NextRequest) {
  const body = await request.text()
  const event = request.headers.get('x-github-event')
  const signature = request.headers.get('x-hub-signature-256')

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (event && APP_EVENTS.has(event)) {
    return handleAppEvent(event, body, signature, payload)
  }

  const repoFullName = (
    payload.repository as { full_name?: string } | undefined
  )?.full_name

  // Delivery 1: a repo hook the OAuth connection created — workspace from the
  // repository name, signature against that integration's own secret.
  const webhooks = repoFullName
    ? await githubService.findWebhooksByRepo(repoFullName)
    : []
  const matched = webhooks.find(
    w =>
      w.integration.webhookSecret &&
      verifyGitHubSignature(body, signature, w.integration.webhookSecret)
  )

  if (matched && repoFullName) {
    // LUM-884: the old OAuth hook is bounded by the same confirmed list as the
    // App webhook — an unconfirmed repository (or a workspace without the App,
    // which has no list) gets no PR metadata or comments written. Authentic,
    // so 200 rather than 401: it is not an error, and a 401 would only mark
    // the delivery failed in GitHub's log.
    const confirmed = await githubAppInstallService.isRepositoryConfirmed(
      matched.integration.workspaceId,
      repoFullName
    )
    if (confirmed) {
      await dispatchRepoEvent(
        event,
        payload,
        matched.integration.workspaceId,
        matched.integration.id
      )
    }
    return NextResponse.json({ ok: true })
  }

  // Delivery 2: the App's own webhook, which carries no per-repo secret and
  // no GitHubWebhook row. Same events, different envelope.
  const viaApp = await resolveAppDelivery(body, signature, payload)
  if (viaApp === 'UNAUTHENTICATED') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Authentic but unplaceable workspaces (unknown installation, or a
  // repository nobody confirmed) come back as an empty list: accept and drop
  // — it was delivered correctly, there is just nothing here for it.
  //
  // A workspace whose own OAuth repo hook is live on this repo gets the same
  // event twice — once per delivery. The repo hook owns it; handling the App
  // copy as well would race the inbound comment dedup (which reads before it
  // writes) and can double-post. Skip it here and let the repo-hook request
  // do the work. LUM-924: every other workspace that confirmed the repository
  // is handled, one after another, each against its own PR rows.
  const hooked = new Set(webhooks.map(w => w.integration.workspaceId))
  for (const workspaceId of viaApp) {
    // LUM-1127: the OAuth repo hook never subscribes to review threads, so
    // the App copy is the only delivery of that event — never skipped.
    if (hooked.has(workspaceId) && !APP_ONLY_REPO_EVENTS.has(event ?? ''))
      continue
    await dispatchRepoEvent(event, payload, workspaceId, null)
  }

  return NextResponse.json({ ok: true })
}

/**
 * Hand one repository event to its handler for one workspace. Errors are
 * logged, never thrown: one workspace's failure must not stop the next
 * workspace from getting the event. GitHub does not redeliver a failed
 * delivery on its own (only by hand, from the App's delivery log), so a
 * non-2xx would buy nothing here; a lost event is caught up by the next one
 * for the same PR.
 */
async function dispatchRepoEvent(
  event: string | null,
  payload: Record<string, unknown>,
  workspaceId: string,
  integrationId: string | null
) {
  try {
    switch (event) {
      case 'pull_request':
        await handlePullRequest(payload, workspaceId, integrationId)
        break
      case 'push':
        await handlePush(payload, workspaceId)
        break
      case 'check_suite':
        await handleCheckSuite(payload, workspaceId)
        break
      case 'issue_comment':
        await handleIssueComment(payload, workspaceId, integrationId)
        break
      case 'pull_request_review':
        await handlePullRequestReview(payload, workspaceId, integrationId)
        break
      case 'pull_request_review_comment':
        await handlePullRequestReviewComment(
          payload,
          workspaceId,
          integrationId
        )
        break
      case 'pull_request_review_thread':
        await handlePullRequestReviewThread(payload, workspaceId)
        break
    }
  } catch (err) {
    logger.error(
      `[webhook/github] error handling ${event} for workspace ${workspaceId}: ${String(err)}`
    )
  }
}

/**
 * App-level webhook branch. Fails closed: no configured App secret means we
 * cannot authenticate the delivery, so it is rejected rather than trusted.
 */
async function handleAppEvent(
  event: string,
  body: string,
  signature: string | null,
  payload: Record<string, unknown>
) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!secret || !verifyGitHubSignature(body, signature, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    if (event === 'installation') {
      await githubAppInstallService.applyInstallationEvent(payload)
    } else if (event === 'repository') {
      await githubAccessRecheckService.applyRepositoryEvent(payload)
    } else {
      await githubAppInstallService.applyInstallationRepositoriesEvent(payload)
    }
  } catch (err) {
    // 200 anyway. GitHub does not redeliver failed deliveries on its own, so
    // answering 500 would only mark this one failed in the App's delivery
    // log. What a failure leaves behind is the daily access recheck's job
    // (/api/cron/recheck-github-access, so up to a day late), which covers
    // each of these events:
    // - installation deleted / suspend, a workspace's unbind failed: its row
    //   is kept; the recheck cannot mint a token for the installation, asks
    //   GitHub, and unbinds and scrubs it (behind the LUM-927 breaker);
    // - installation created / unsuspend / new_permissions_accepted and
    //   installation_repositories, a narrowing failed: a repository that left
    //   the installation stays confirmed until the recheck narrows every row
    //   to the installation's live repositories (LUM-927);
    // - repository privatized / transferred, the targeted recheck failed: the
    //   daily pass asks about every confirmed repository again;
    // - repository renamed / transferred / deleted, the rename or removal
    //   failed (LUM-879): the old name is no longer in the installation, so
    //   the daily narrowing drops it with its code (re-verify restores a
    //   renamed one).
    logger.error(`[webhook/github] error handling ${event}: ${String(err)}`)
  }

  return NextResponse.json({ ok: true })
}

/**
 * Authenticate a repository event that arrived on the App webhook and map it to
 * a workspace through `installation.id` plus the event's repository — such a
 * delivery has no GitHubWebhook row behind it, and the installation alone is
 * not enough: only repositories the workspace has confirmed are routed
 * (LUM-881), so one added to the installation later stays out until verified.
 *
 * Returns every workspace that confirmed the repository (LUM-924) — empty when
 * the delivery is authentic but belongs to no workspace (unknown installation,
 * or an unconfirmed repository) — and 'UNAUTHENTICATED' when it is not an App
 * delivery at all.
 */
async function resolveAppDelivery(
  body: string,
  signature: string | null,
  payload: Record<string, unknown>
): Promise<string[] | 'UNAUTHENTICATED'> {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!secret || !verifyGitHubSignature(body, signature, secret)) {
    return 'UNAUTHENTICATED'
  }

  const installationId = (payload.installation as { id?: number } | undefined)
    ?.id
  if (!installationId) return []

  const repositoryFullName =
    (payload.repository as { full_name?: string } | undefined)?.full_name ??
    null

  return githubAppInstallService.resolveWorkspacesForRepository(
    installationId,
    repositoryFullName
  )
}
