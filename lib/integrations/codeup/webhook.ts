/**
 * LUM-1315 — Codeup webhook deliveries: event names, token checks and the
 * payload fields Lumo reads.
 *
 * Codeup sends the event in the `Codeup-Event` header (`Push Hook`,
 * `Merge Request Hook`, …) and the hook's static secret in `X-Codeup-Token`
 * (no HMAC). Payloads are GitLab-shaped (Alibaba Cloud "Webhook 设置" guide):
 * a push carries `project_id`, `ref`, `after`, `commits`; a merge request
 * carries `object_kind: merge_request` and `object_attributes`.
 */
import { createHash, timingSafeEqual } from 'crypto'

export const CODEUP_EVENT_HEADER = 'codeup-event'
export const CODEUP_TOKEN_HEADER = 'x-codeup-token'

export const CODEUP_PUSH_EVENT = 'Push Hook'
export const CODEUP_MERGE_REQUEST_EVENT = 'Merge Request Hook'

const ZERO_SHA = /^0+$/

/** SHA-256 hex of a webhook token — what Lumo stores instead of the token. */
export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Whether `token` is the one whose hash is `storedHash`. Compares the two
 * fixed-length digests in constant time, so neither the token's length nor
 * a matching prefix shows in the timing.
 */
export function webhookTokenMatches(
  token: string,
  storedHash: string
): boolean {
  const given = Buffer.from(hashWebhookToken(token), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (given.length !== stored.length || stored.length === 0) return false
  return timingSafeEqual(given, stored)
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function date(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The Codeup repository id a delivery is about: `project_id` on a push,
 * the target project of a merge request. null when the payload carries none.
 */
export function deliveryRepositoryId(payload: unknown): number | null {
  const p = obj(payload)
  if (!p) return null
  if (typeof p.project_id === 'number') return p.project_id
  const attrs = obj(p.object_attributes)
  if (attrs && typeof attrs.target_project_id === 'number') {
    return attrs.target_project_id
  }
  return null
}

/** Codeup's merge request states collapsed to Lumo's PR states. */
export function mergeRequestState(state: string): 'open' | 'closed' | 'merged' {
  if (state === 'merged') return 'merged'
  if (state === 'closed' || state === 'locked') return 'closed'
  return 'open'
}

export interface CodeupMergeRequestEvent {
  /** Codeup's per-repository merge request number. */
  iid: number
  action: string | null
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  sourceBranch: string
  targetBranch: string
  headSha: string | null
  authorLogin: string
  isDraft: boolean
  updatedAt: Date | null
}

/** The fields of a `Merge Request Hook` Lumo reads; null when malformed. */
export function parseMergeRequestEvent(
  payload: unknown
): CodeupMergeRequestEvent | null {
  const p = obj(payload)
  const attrs = obj(p?.object_attributes)
  if (!p || !attrs) return null
  const iid = attrs.iid
  const sourceBranch = str(attrs.source_branch)
  const targetBranch = str(attrs.target_branch)
  const url = str(attrs.url)
  const rawState = str(attrs.state)
  if (
    typeof iid !== 'number' ||
    !sourceBranch ||
    !targetBranch ||
    !url ||
    !rawState
  ) {
    return null
  }
  const user = obj(p.user)
  const lastCommit = obj(attrs.last_commit)
  return {
    iid,
    action: str(attrs.action),
    title: str(attrs.title) ?? `!${iid}`,
    url,
    state: mergeRequestState(rawState),
    sourceBranch,
    targetBranch,
    headSha: str(lastCommit?.id),
    authorLogin: str(user?.username) ?? str(user?.name) ?? 'unknown',
    isDraft: attrs.work_in_progress === true,
    updatedAt: date(attrs.updated_at),
  }
}

export interface CodeupPushEvent {
  branchName: string
  headSha: string
  /** First line of the head commit's message. */
  commitMessage: string | null
  commitAuthor: string | null
}

/**
 * The branch push in a `Push Hook`; null for a tag push, a branch deletion
 * or a malformed payload.
 */
export function parsePushEvent(payload: unknown): CodeupPushEvent | null {
  const p = obj(payload)
  if (!p) return null
  const ref = str(p.ref)
  const after = str(p.after)
  if (!ref || !ref.startsWith('refs/heads/') || !after || ZERO_SHA.test(after))
    return null
  const branchName = ref.slice('refs/heads/'.length)
  if (!branchName) return null
  const commits = Array.isArray(p.commits) ? p.commits.map(obj) : []
  const head =
    commits.find(c => c && c.id === after) ?? commits[commits.length - 1]
  const message = str(head?.message)
  return {
    branchName,
    headSha: after,
    commitMessage: message ? (message.split('\n')[0] ?? null) : null,
    commitAuthor: str(obj(head?.author)?.name) ?? str(p.user_name),
  }
}
