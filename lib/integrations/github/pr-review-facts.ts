/**
 * LUM-1143 — the facts the per-repository auto-review filters read, off a
 * `pull_request` webhook payload, and — for labeled / unlabeled / edited —
 * the same facts as they were before the event (GitHub sends the label that
 * changed and `changes.{title,body,base}.from`). PURE.
 */
import type { PullRequestReviewFacts } from '@/lib/plugins/types'

export interface PullRequestFactsPayload {
  action: string
  pull_request: {
    title?: string | null
    body?: string | null
    user?: { login?: string } | null
    base?: { ref?: string } | null
    labels?: Array<{ name?: string } | null> | null
  }
  repository: { default_branch?: string | null }
  label?: { name?: string } | null
  changes?: {
    title?: { from?: string }
    body?: { from?: string | null }
    base?: { ref?: { from?: string } }
  } | null
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export function pullRequestReviewFacts(
  payload: PullRequestFactsPayload
): PullRequestReviewFacts {
  const pr = payload.pull_request
  return {
    baseBranch: str(pr.base?.ref),
    defaultBranch: str(payload.repository.default_branch),
    labels: (pr.labels ?? [])
      .map(l => str(l?.name))
      .filter((n): n is string => n !== null),
    title: str(pr.title),
    body: str(pr.body),
    authorLogin: str(pr.user?.login),
  }
}

/**
 * The facts before a labeled / unlabeled / edited event, or undefined when
 * the event changed nothing a filter reads (another action, an edit of
 * something else).
 */
export function pullRequestReviewFactsBefore(
  payload: PullRequestFactsPayload,
  after: PullRequestReviewFacts
): PullRequestReviewFacts | undefined {
  const label = str(payload.label?.name)
  if (payload.action === 'labeled' && label !== null)
    return { ...after, labels: after.labels.filter(l => l !== label) }
  if (payload.action === 'unlabeled' && label !== null)
    return after.labels.includes(label)
      ? undefined
      : { ...after, labels: [...after.labels, label] }
  if (payload.action !== 'edited' || !payload.changes) return undefined
  const { title, body, base } = payload.changes
  if (!title && !body && !base) return undefined
  return {
    ...after,
    ...(title ? { title: str(title.from) } : {}),
    ...(body ? { body: str(body.from) } : {}),
    ...(base?.ref ? { baseBranch: str(base.ref.from) } : {}),
  }
}
