import { NextRequest, NextResponse } from 'next/server'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import {
  handlePullRequest,
  handleCheckSuite,
  handleStatus,
  handlePush,
  handleIssueComment,
  handlePullRequestReview,
  handlePullRequestReviewComment,
} from './handlers'
import { githubService } from '@/lib/services/github.service'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'

/** Events delivered by the App-level webhook rather than the OAuth repo hook. */
const APP_EVENTS = new Set(['installation', 'installation_repositories'])

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub webhook events over two independent deliveries that share
 * this endpoint:
 *
 * - **Repo hooks** created by the OAuth connection (pull_request, push,
 *   check_suite, status, comments, reviews). The workspace comes from
 *   `repository.full_name` and the signature is checked against that
 *   integration's own `webhookSecret`.
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

  let workspaceId: string
  let integrationId: string | null = null

  if (matched) {
    workspaceId = matched.integration.workspaceId
    integrationId = matched.integration.id
  } else {
    // Delivery 2: the App's own webhook, which carries no per-repo secret and
    // no GitHubWebhook row. Same events, different envelope.
    const viaApp = await resolveAppDelivery(body, signature, payload)
    if (viaApp === 'UNAUTHENTICATED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Authentic but unplaceable (unknown or uninstalled installation): accept
    // and drop it — a 401 here would put GitHub into an endless retry.
    if (!viaApp) return NextResponse.json({ ok: true })

    // Both hooks are live on this repo, so GitHub sends the same event twice —
    // once per delivery. The repo hook owns it; handling the App copy as well
    // would race the inbound comment dedup (which reads before it writes) and
    // can double-post. Drop this copy and let the repo-hook request do the work.
    if (webhooks.some(w => w.integration.workspaceId === viaApp)) {
      return NextResponse.json({ ok: true })
    }

    workspaceId = viaApp
  }

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
      case 'status':
        await handleStatus(payload, workspaceId)
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
    }
  } catch (err) {
    console.error(`[webhook/github] error handling ${event}:`, err)
    // Return 200 to prevent GitHub retrying indefinitely
  }

  return NextResponse.json({ ok: true })
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
    } else {
      await githubAppInstallService.applyInstallationRepositoriesEvent(payload)
    }
  } catch (err) {
    logger.error(`[webhook/github] error handling ${event}: ${String(err)}`)
    // 200 anyway — GitHub retries indefinitely otherwise.
  }

  return NextResponse.json({ ok: true })
}

/**
 * Authenticate a repository event that arrived on the App webhook and map it to
 * a workspace through `installation.id` — the only handle such a delivery
 * carries, since it has no GitHubWebhook row behind it.
 *
 * Returns the workspace id, `null` when the delivery is authentic but belongs
 * to an installation we cannot place, and 'UNAUTHENTICATED' when it is not an
 * App delivery at all.
 */
async function resolveAppDelivery(
  body: string,
  signature: string | null,
  payload: Record<string, unknown>
): Promise<string | null | 'UNAUTHENTICATED'> {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!secret || !verifyGitHubSignature(body, signature, secret)) {
    return 'UNAUTHENTICATED'
  }

  const installationId = (payload.installation as { id?: number } | undefined)
    ?.id
  if (!installationId) return null

  return githubAppInstallService.resolveWorkspaceByInstallation(installationId)
}
