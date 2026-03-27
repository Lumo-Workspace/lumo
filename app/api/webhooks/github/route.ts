import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { verifyGitHubSignature } from '@/lib/github/verify'
import { handlePullRequest, handleCheckSuite } from './handlers'

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub webhook events. Identifies the workspace by matching
 * the repo full_name to a GitHubWebhook record, then verifies the HMAC
 * signature against the integration's webhookSecret.
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

  const repoFullName = (
    payload.repository as { full_name?: string } | undefined
  )?.full_name
  if (!repoFullName) return NextResponse.json({ ok: true })

  // Find all integrations that registered a webhook for this repo
  const webhooks = await prisma.gitHubWebhook.findMany({
    where: { repo: repoFullName },
    include: {
      integration: {
        select: { id: true, workspaceId: true, webhookSecret: true },
      },
    },
  })

  // Find the one whose secret validates this signature
  const matched = webhooks.find(
    w =>
      w.integration.webhookSecret &&
      verifyGitHubSignature(body, signature, w.integration.webhookSecret)
  )

  if (!matched) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, id: integrationId } = matched.integration

  try {
    switch (event) {
      case 'pull_request':
        await handlePullRequest(payload, workspaceId, integrationId)
        break
      case 'check_suite':
        await handleCheckSuite(payload, workspaceId)
        break
      // pull_request_review — future
    }
  } catch (err) {
    console.error(`[webhook/github] error handling ${event}:`, err)
    // Return 200 to prevent GitHub retrying indefinitely
  }

  return NextResponse.json({ ok: true })
}
