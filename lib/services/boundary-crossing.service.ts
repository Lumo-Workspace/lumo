import { formatCrossingRef } from '@/lib/boundary-crossing/crossing-ref'
import { createHash } from 'crypto'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import {
  suppressionDirectory,
  suppressionPatternFor,
  type SuppressionScope,
  isSuppressibleCategory,
  RETROACTIVE_SUPPRESSION_CAP,
} from '@/lib/boundary-crossing/suppression'
import { taskRepository } from '@/lib/repositories/task.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { resolveEffectiveBindingSession } from '@/lib/services/effective-binding-session'
import { parseChildSessionId } from '@/lib/session/child-session-id'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { createTask } from '@/lib/services/task-creation.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { toModelCosts } from '@/lib/services/model-cost'
import type { ModelUsage } from '@/lib/services/model-cost'
import { sanitizeField } from '@/lib/utils/sanitize'
import { hasRedactedContent } from '@/lib/hook-payload/redact'
import {
  recordAuditEvent,
  type WorkspaceAudit,
} from '@/lib/services/audit.service'
import type {
  BoundaryCrossingDisposition,
  BoundaryCrossingSeverity,
  TaskArtifactAgent,
  TaskStatus,
} from '@prisma/client'

/**
 * LUM-769: which surface a disposition came through. `WEB` is a human click in
 * the acceptance panel (a Clerk browser session). `CLI` is
 * `lumo crossing disposition … --confirm` — the agent relayed the exit-4
 * confirmation envelope and the user approved in chat, which the server cannot
 * verify, so the channel is recorded on the audit row and surfaced in the read
 * model instead of being folded into the web-click shape. `SYSTEM` (LUM-772)
 * is a scripted re-judgement (`scripts/backfill-prv-rejudge.ts`) — no human
 * actor, never a web click.
 */
export type DispositionChannel = 'WEB' | 'CLI' | 'SYSTEM'

import {
  acknowledgeReadReceipt,
  crossingStateHash,
  issueReadReceipt,
  readReceiptSecret,
  verifyReadReceipt,
  receiptRefusal,
  type IssuedReceipt,
  type ReceiptSubject,
} from '@/lib/disposition/read-receipt'
import { crossingExplainer } from '@/lib/plugins/crossings'

/** LUM-769: who is asking for / presenting a read receipt. */
export interface ReceiptCaller {
  sessionId: string | null
  memberId: string
}

export interface DispositionAttribution {
  /** WorkspaceMember id of the dispositioning human. */
  actorMemberId: string
  /** Clerk user id of the dispositioning human. */
  actorClerkId: string
  /** LUM-769: surface the ruling came through. Absent/`WEB` = the web panel
   *  (payload shape unchanged); `CLI` is stamped on the audit payload. */
  channel?: DispositionChannel
  /** LUM-769 handshake timestamps (CLI path only): when the envelope was
   *  shown and when reading was acknowledged — recorded on the audit row. */
  handshake?: { readAt: string; readAcknowledgedAt: string }
  /** LUM-907: the workspace audit log entry for this ruling / revoke.
   *  Required: a ruling is always audited, so a caller that forgets the
   *  context fails to compile instead of silently skipping the audit row. */
  audit: WorkspaceAudit
}

/** LUM-751: optional repository-rule opt-in riding a FALSE_POSITIVE ruling. */
export interface DispositionOptions {
  suppressSimilarInProject?: boolean
  suppressionReason?: string | null
  /** LUM-963: `directory` widens the rule to every file under the crossing's
   *  directory (SENSITIVE_PATH_READ only); default `exact`. */
  suppressionScope?: SuppressionScope
}

export interface DispositionOutcome {
  crossingId: string
  /** The crossing's disposition after the write; null when reverted to OPEN
   *  (undispositioned) by a re-disposition (LUM-450). */
  disposition: BoundaryCrossingDisposition | null
  /** LUM-751: the repository suppression rule created alongside a
   *  FALSE_POSITIVE when the human opted in; null otherwise. */
  suppressionRuleId?: string | null
  /** LUM-759: how many ALREADY-RECORDED open crossings that new rule
   *  retroactively dispositioned. Present only when a rule was created. */
  retroactivelySuppressed?: number
  /** LUM-759: true when there were more matches than the per-creation cap and
   *  only the most recent {@link RETROACTIVE_SUPPRESSION_CAP} were stamped —
   *  the caller tells the human rather than silently truncating. */
  retroactiveCapped?: boolean
}

/** LUM-759: read-only blast radius of a rule the human has not created yet. */
export interface SuppressionScopePreview {
  /** Whether a rule can be built from this crossing at all (suppressible
   *  category with a coalescing target) — the panel hides the opt-in
   *  otherwise, and the server would refuse it with 422. */
  suppressible: boolean
  /** Existing OPEN crossings in this project, other than this one, that the
   *  rule would dispose. Capped-aware: never more than `cap`. */
  count: number
  /** True when there are more matches than `cap` — only the most recent `cap`
   *  would be stamped. */
  capped: boolean
  cap: number
}

export interface SpawnRemediationOutcome {
  crossingId: string
  remediationTaskId: string
  remediationTaskIdentifier: string
}

/** A linked remediation task surfaced on a crossing, with its live status. */
export interface RemediationTaskView {
  identifier: string
  title: string
  status: TaskStatus
  /** Derived: the linked fix task has reached DONE. */
  remediated: boolean
}

/**
 * The triggering edit's change content, surfaced inline on a display-safe
 * crossing (LUM-452) so a reviewer can judge a legit test fix vs a weakened test
 * WITHOUT opening the PR. Sanitized (LUM-346) and length-capped (LUM-348). Null
 * on the crossing when the category isn't display-safe (e.g. HARDCODED_SECRET —
 * the secret value is never routed here; criterion 2).
 */
export interface EditChangeView {
  /** 'edit' = old→new (Edit); 'write' = content only (Write); null when the
   *  triggering event/content is unavailable. */
  kind: 'edit' | 'write' | null
  /** The removed text (Edit `old_string`); null for a Write or when unavailable. */
  oldText: string | null
  /** The added text (Edit `new_string` / Write `content`); null when unavailable. */
  newText: string | null
  /** True when either side was length-capped for display (LUM-348). */
  truncated: boolean
  /** Non-null when the edit content couldn't be surfaced — a reviewer-facing
   *  reason code so the row is never blank (criterion 4). */
  unavailable: string | null
  /** The task's PR url when one exists — the fallback's "go look here" (criterion 4). */
  prUrl: string | null
  /** Deep link straight to THIS file's diff inside the PR (LUM-455) —
   *  `{prUrl}/files#diff-<sha256(path)>`. Falls back to `{prUrl}/files` when the
   *  file path is unknown, and null when there is no PR. The reviewer lands on
   *  the changed file, not the PR root. */
  prFileUrl: string | null
  /** The agent's stated intent for the TURN this edit belongs to (LUM-455) — the
   *  LLM turn summary of the STOP that bounded the edit. Turn-level, not per-edit:
   *  Claude Code's hooks carry no per-edit reason, so this is the closest proxy.
   *  Null when the turn hasn't ended / has no summary, or the event is unknown. */
  agentTurnContext: string | null
}

/**
 * The most recent re-disposition of a crossing (LUM-450) — surfaced on the
 * acceptance bar so a correction reads as a correction (from -> to, by whom),
 * never a silent swap. Only a genuine CHANGE is surfaced: an initial
 * undispositioned -> X disposition is not a correction (`from` is null there),
 * so it is excluded. `from`/`to` use null for OPEN; a revert to open has
 * `to === null`.
 */
export interface DispositionChangeView {
  from: BoundaryCrossingDisposition | null
  to: BoundaryCrossingDisposition | null
  actorId: string | null
  at: string
  /** LUM-769: `CLI` when the correction came through
   *  `lumo crossing disposition --confirm`, else `WEB`. */
  channel: DispositionChannel
}

/**
 * Read-only attribution for a crossing (LUM-469): WHO (workspace member), WHICH
 * agent/session, and WHAT model committed the boundary-crossing action, all
 * derived from the crossing's linked hook event (+ its session, + the turn's
 * usageByModel). Every field degrades to null when it can't be resolved — null
 * is "unknown", never a fabricated value (criterion 2/3). Additive: no write
 * path, no new stored column — this is join/correlate at read time.
 */
export interface CrossingAttributionView {
  /** WorkspaceMember id that owns the triggering hook event — the human whose
   *  agent crossed. Null when the crossing has no resolvable linked event. */
  workspaceMemberId: string | null
  /** The agent session (Claude Code session UUID) that produced the event. */
  sessionId: string | null
  /** The coding-agent type that owns the session (CLAUDE_CODE, …). Null when the
   *  session can't be resolved. */
  agent: TaskArtifactAgent | null
  /** The git branch of the session's worktree, when known (which branch). */
  worktreeBranch: string | null
  /** The model running for the turn this crossing belongs to — taken from the
   *  hook payload when it carries one, else correlated from the turn's
   *  usageByModel (LUM-298, dominant model). Null = unknown, never fabricated. */
  model: string | null
}

/**
 * LUM-542: an append-only agent self-explanation ("申辩") on a crossing. A
 * reviewer aid + retrospective record — NOT a disposition. `note` is sanitized
 * at this read boundary (untrusted free text); the panel labels it as an agent
 * self-report that is unverified.
 */
export interface ExplanationView {
  id: string
  /** Sanitized note text. */
  note: string
  /** Agent type that authored it (X-Lumo-Agent), when known. */
  authorAgent: string | null
  /** Originating session, when known. */
  authorSessionId: string | null
  createdAt: string
}

/** Outcome of recording one explanation (LUM-542). */
export interface ExplainOutcome {
  crossingId: string
  explanation: ExplanationView
}

/** Full crossing view for the acceptance bar — open AND dispositioned (LUM-435). */
export interface BoundaryCrossingView {
  id: string
  /** LUM-1059: the human-readable `<TEAM>-X<n>` ref (the cuid when unnumbered). */
  ref: string
  category: string
  detail: string
  detectedAt: string
  reversible: boolean
  /** How many detections coalesced into this crossing (LUM-477) — 1 unless the
   *  same action/file recurred while open. The bar shows "seen ×N" when > 1 so a
   *  reviewer dispositions a repeated crossing once and still sees it recurred. */
  occurrenceCount: number
  /** When the crossing was last (re)detected (LUM-477); falls back to detectedAt
   *  for a crossing that never recurred. */
  lastSeenAt: string
  /** Severity tier (LUM-442) — read-model exposes it; the bar orders by it. */
  severity: BoundaryCrossingSeverity
  disposition: BoundaryCrossingDisposition | null
  dispositionNote: string | null
  dispositionedAt: string | null
  dispositionedById: string | null
  /** LUM-769: which surface the CURRENT disposition came through — `CLI` for
   *  `lumo crossing disposition --confirm` (user approval relayed by the agent,
   *  unverifiable server-side), `WEB` for a panel click. Null while open, and
   *  for system dispositions that wrote no activity row (AUTO_LEGIT / rule). */
  dispositionChannel: DispositionChannel | null
  remediationTask: RemediationTaskView | null
  /** Inline before→after of the triggering edit, for display-safe crossings only
   *  (LUM-452). Null for non-display-safe (secret-bearing) crossings. */
  editChange: EditChangeView | null
  /** The latest re-disposition of this crossing (LUM-450), or null when it was
   *  never corrected (still open, or dispositioned exactly once). */
  lastDispositionChange: DispositionChangeView | null
  /** Who/what crossed (LUM-469) — owner member, agent/session, model. Always
   *  present; every field is null when it can't be resolved (unknown). */
  attribution: CrossingAttributionView
  /** LUM-945: P(legit) from the AI triage, and which model; null = not
   *  triaged (or not judged). At or above the threshold the row is AUTO_LEGIT. */
  triageProbability: number | null
  triageModel: string | null
  /** LUM-542: append-only agent self-explanations ("申辩"), oldest-first. Each
   *  note is sanitized; the panel labels them agent self-report / unverified.
   *  Orthogonal to disposition — a reviewer aid + retrospective record, never a
   *  verdict. Empty when the agent recorded none. */
  explanations: ExplanationView[]
  /** LUM-590: advisory crossings surface in the panel but never block DONE;
   *  a human disposition is encouraged but never required (true = advisory). */
  advisory: boolean
  /** LUM-780: the latest SYSTEM re-judge that turned this crossing advisory
   *  because its cause no longer holds — reason, evidence, which criterion
   *  judged it, when. Null when the row was never re-judged. Read-only trail
   *  (a BOUNDARY_CROSSING_REJUDGED activity); never a disposition. */
  rejudge: RejudgeView | null
  /** LUM-590: which compiled PolicyRule fired (text ref / id); null when the
   *  crossing was not from a project-rule detector. */
  policyRuleRef: string | null
  /** LUM-590: frozen verbatim text of the policy rule at detection time; null
   *  for non-project-rule crossings. */
  policyRuleText: string | null
  /** LUM-590: turn-level intent the agent stated for the turn containing this
   *  crossing; null when not derivable (no turn stops loaded for this session). */
  agentContext: string | null
  /** LUM-590: cached SYSTEM-generated plain-language explanation for this
   *  crossing; null = not yet generated (human must click "Explain"). ADVISORY
   *  ONLY — never changes disposition or the DONE gate. */
  systemExplanation: string | null
  /** LUM-751: the category may be rule-suppressed AND the crossing carries a
   *  coalescing target — the panel offers the per-repository opt-in only then. */
  suppressible: boolean
  /** LUM-963: the directory a `directory`-scoped rule would cover, or null
   *  when that scope is not offered (category, or a too-broad directory). */
  suppressionDirectory: string | null
  /** LUM-912: the raw text (detail, target, explanations) was replaced by a
   *  code-free description some days after the disposition. The panel says
   *  the original was not retained and offers no Explain. */
  rawPurged: boolean
  /** LUM-751: the rule that auto-dispositioned this crossing (AUTO_SUPPRESSED);
   *  null for every other crossing. */
  suppressionRule: {
    id: string
    reason: string | null
    revokedAt: string | null
  } | null
}

/**
 * Categories whose triggering edit is SAFE to surface inline. An allowlist, never
 * a denylist: a secret-bearing class (HARDCODED_SECRET) is simply absent here, so
 * the no-echo-secret red line (LUM-426) can never be regressed by this path even
 * if a new secret-bearing category is added later (criterion 2).
 */
const EDIT_CONTENT_SAFE_CATEGORIES: ReadonlySet<string> = new Set([
  'TEST_TAMPERING',
])

/** Display cap for a surfaced edit snippet. The stored payload is already bounded
 *  to HOOK_FREE_TEXT_CAP (64k, LUM-348); this tighter per-side cap keeps the
 *  inline view legible and the read-model payload small. */
export const EDIT_SNIPPET_CAP = 4_000

/** A linked hook event, narrowed to what the edit-change view needs.
 *  `sessionId`/`createdAt` (LUM-455) locate the turn the edit belongs to. */
export interface EditChangeHookEvent {
  toolName: string | null
  payload: unknown
  sessionId?: string | null
  createdAt?: Date | string | null
}

/** A STOP row's turn summary, keyed for locating the turn that bounds an edit. */
export interface TurnSummaryRow {
  sessionId: string | null
  createdAt: Date | string
  turnSummary: string | null
}

/**
 * The summary of the turn an edit belongs to (LUM-455): the earliest STOP in the
 * same session whose `createdAt` is at or after the edit — i.e. the STOP that
 * ended the turn containing the edit. Turn-level, best-effort: null when the
 * session/time is unknown or no later summarized STOP exists.
 */
export function turnContextForEvent(
  event: EditChangeHookEvent | null,
  stops: TurnSummaryRow[]
): string | null {
  if (!event?.sessionId || event.createdAt == null) return null
  const editAt = new Date(event.createdAt).getTime()
  let best: { at: number; summary: string } | null = null
  for (const s of stops) {
    if (s.sessionId !== event.sessionId || !s.turnSummary) continue
    const at = new Date(s.createdAt).getTime()
    if (at < editAt) continue
    if (!best || at < best.at) best = { at, summary: s.turnSummary }
  }
  return best?.summary ?? null
}

/** A linked hook event, narrowed to what the attribution view needs (LUM-469):
 *  the owning member, the session (+ its agent type and worktree branch), the
 *  raw payload (a model may be carried there), and createdAt for turn lookup. */
export interface AttributionHookEvent {
  workspaceMemberId: string | null
  sessionId: string | null
  payload: unknown
  createdAt?: Date | string | null
  session?: {
    agent: TaskArtifactAgent | null
    worktree?: { branch: string | null } | null
  } | null
}

/** A STOP row's per-turn token map (LUM-298), keyed for locating the turn that
 *  bounds an edit so its dominant model can be read off. */
export interface TurnUsageRow {
  sessionId: string | null
  createdAt: Date | string
  usageByModel: unknown
}

/** Best-effort: a model name carried directly on the hook payload. Claude Code's
 *  tool-use payloads don't carry one today, but the criterion takes it as-is when
 *  present (the simplest, most direct source); null otherwise. */
function modelFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const m = (payload as Record<string, unknown>).model
  return typeof m === 'string' && m.length > 0 ? m : null
}

/**
 * The model that ran for the turn a crossing's event belongs to (LUM-469). First
 * the direct path — a model carried on the hook payload. Otherwise correlate:
 * the earliest STOP in the same session whose `createdAt` is at or after the
 * event (the STOP that ended the turn containing the action, mirroring
 * {@link turnContextForEvent}), and take that turn's dominant model from
 * usageByModel (LUM-298, highest total tokens). Null when nothing resolves —
 * "unknown", never fabricated.
 */
export function modelForEvent(
  event: AttributionHookEvent | null,
  usageStops: TurnUsageRow[]
): string | null {
  if (!event) return null
  const direct = modelFromPayload(event.payload)
  if (direct) return direct
  if (!event.sessionId || event.createdAt == null) return null
  const editAt = new Date(event.createdAt).getTime()
  let best: { at: number; usage: unknown } | null = null
  for (const s of usageStops) {
    if (s.sessionId !== event.sessionId || !s.usageByModel) continue
    const at = new Date(s.createdAt).getTime()
    if (at < editAt) continue
    if (!best || at < best.at) best = { at, usage: s.usageByModel }
  }
  if (!best) return null
  const costs = toModelCosts(best.usage as Record<string, ModelUsage> | null)
  return costs?.[0]?.model ?? null
}

/**
 * Build the read-only attribution view for a crossing (LUM-469). Pure — the
 * linked hook event and the already-resolved model are passed in. Every field
 * degrades to null when the source can't be resolved, so a crossing with no
 * linked event (or a vanished one) yields all-null attribution rather than
 * throwing (criterion 3).
 */
export function buildAttributionView(
  event: AttributionHookEvent | null,
  model: string | null
): CrossingAttributionView {
  return {
    workspaceMemberId: event?.workspaceMemberId ?? null,
    sessionId: event?.sessionId ?? null,
    agent: event?.session?.agent ?? null,
    worktreeBranch: event?.session?.worktree?.branch ?? null,
    model,
  }
}

/** The session projection a hook-less crossing attributes through (LUM-511). */
export interface AttributionSession {
  id: string
  workspaceMemberId: string
  agent: TaskArtifactAgent | null
  worktree?: { branch: string | null } | null
  /** Cumulative per-model token map (LUM-298) — its dominant model names the
   *  model that ran the session. */
  usageByModel: unknown
}

/**
 * Build the attribution view from the originating session (LUM-511). The
 * fallback for crossings recorded without a hook event (spinoff laundering is
 * detected on a `lumo task create` call): owner/agent/worktree come straight off
 * the session, and the model is the dominant one in its cumulative usageByModel
 * (LUM-298, highest total tokens) — the session-level analog of
 * {@link modelForEvent}'s per-turn read. Every field degrades to null, never
 * fabricated; a missing session yields all-null attribution.
 */
export function attributionFromSession(
  session: AttributionSession | null
): CrossingAttributionView {
  if (!session) {
    return {
      workspaceMemberId: null,
      sessionId: null,
      agent: null,
      worktreeBranch: null,
      model: null,
    }
  }
  const costs = toModelCosts(
    session.usageByModel as Record<string, ModelUsage> | null
  )
  return {
    workspaceMemberId: session.workspaceMemberId,
    sessionId: session.id,
    agent: session.agent,
    worktreeBranch: session.worktree?.branch ?? null,
    model: costs?.[0]?.model ?? null,
  }
}

function readToolInput(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  return input as Record<string, unknown>
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string') return v
  return null
}

/** Sanitize untrusted agent text (LUM-346) then length-cap it (LUM-348). */
function clampSnippet(value: string): { text: string; truncated: boolean } {
  const clean = sanitizeField(value)
  return clean.length > EDIT_SNIPPET_CAP
    ? { text: clean.slice(0, EDIT_SNIPPET_CAP), truncated: true }
    : { text: clean, truncated: false }
}

/**
 * Build the inline edit-change view for a crossing (LUM-452). Pure — the linked
 * hook event and the task's PR url are passed in. Returns null for any
 * non-display-safe category: the RED LINE is that a secret-bearing crossing
 * (HARDCODED_SECRET, …) surfaces only its redacted detail label and never the
 * written content (LUM-426 / criterion 2). For a display-safe crossing it
 * surfaces the triggering Edit's old→new (or the Write's content), sanitized +
 * capped; when the event or its content is missing it returns a fallback pointer
 * (+ PR url) so a reviewer is never left with a blank (criterion 4).
 */
export function buildEditChangeView(
  category: string,
  hookEvent: EditChangeHookEvent | null,
  prUrl: string | null,
  filePath: string | null = null,
  agentTurnContext: string | null = null
): EditChangeView | null {
  if (!EDIT_CONTENT_SAFE_CATEGORIES.has(category)) return null

  const prFileUrl = prFileLink(prUrl, filePath)

  const fallback = (reason: string): EditChangeView => ({
    kind: null,
    oldText: null,
    newText: null,
    truncated: false,
    unavailable: reason,
    prUrl,
    prFileUrl,
    agentTurnContext,
  })

  if (!hookEvent) return fallback('NO_EVENT')
  const input = readToolInput(hookEvent.payload)
  if (!input) return fallback('NO_PAYLOAD')

  const rawNew = firstString(input.new_string, input.new_str, input.content)
  const rawOld = firstString(input.old_string, input.old_str)
  if (rawNew == null && rawOld == null) {
    // LUM-855: non-test file content is redacted before the event is stored.
    return fallback(
      hasRedactedContent(hookEvent.payload) ? 'NOT_RETAINED' : 'NO_CONTENT'
    )
  }

  // Write = `content` present with no edit-style old/new; otherwise it's an Edit.
  const isWrite =
    input.content != null &&
    input.new_string == null &&
    input.new_str == null &&
    rawOld == null

  const newClamped = rawNew != null ? clampSnippet(rawNew) : null
  const oldClamped = !isWrite && rawOld != null ? clampSnippet(rawOld) : null

  return {
    kind: isWrite ? 'write' : 'edit',
    oldText: oldClamped?.text ?? null,
    newText: newClamped?.text ?? null,
    truncated:
      (newClamped?.truncated ?? false) || (oldClamped?.truncated ?? false),
    unavailable: null,
    prUrl,
    prFileUrl,
    agentTurnContext,
  }
}

/** The repo-relative file path the detector named in a crossing's detail
 *  (`edited <path> — …`, LUM-441) — the clean repo-relative path for a PR file
 *  deep link. Null when the detail doesn't lead with it. */
function filePathFromDetail(detail: string): string | null {
  const m = detail.match(/^edited (\S+)/)
  return m ? m[1]! : null
}

/**
 * Deep link straight to a file's diff inside a PR (LUM-455). GitHub anchors each
 * file in the Files-changed view as `diff-<sha256(path) hex>`; with the path we
 * jump the reviewer to the exact file, with just the PR we still land on the
 * Files tab (better than the PR root), and with no PR at all there is no link.
 */
function prFileLink(
  prUrl: string | null,
  filePath: string | null
): string | null {
  if (!prUrl) return null
  if (!filePath) return `${prUrl}/files`
  const anchor = createHash('sha256').update(filePath).digest('hex')
  return `${prUrl}/files#diff-${anchor}`
}

function iso(d: Date | string | null): string | null {
  if (d == null) return null
  return d instanceof Date ? d.toISOString() : d
}

/** A disposition activity row, narrowed to what the correction view needs. */
export interface DispositionActivityRow {
  payload: unknown
  actorId: string | null
  createdAt: Date | string
}

/** Every `BoundaryCrossingDisposition` value (the enum is imported as a type
 *  only, so the runtime set is spelled out; `satisfies` keeps each spelling
 *  honest against the schema). */
const DISPOSITION_VALUES: ReadonlySet<string> = new Set([
  'FALSE_POSITIVE',
  'CONFIRMED',
  'AUTO_LEGIT',
  'AUTO_SUPPRESSED',
] satisfies BoundaryCrossingDisposition[])

/** Normalize a disposition activity payload's transition, tolerating legacy
 *  rows (pre-LUM-450) that carry only `disposition` (the new value) and no
 *  explicit `from`/`to`. */
function readTransition(payload: unknown): {
  from: BoundaryCrossingDisposition | null
  to: BoundaryCrossingDisposition | null
} {
  const p = (payload ?? {}) as Record<string, unknown>
  // LUM-771: every disposition value, including the system ones — a human
  // correcting AUTO_SUPPRESSED / AUTO_LEGIT is a correction, not a first ruling.
  const norm = (v: unknown): BoundaryCrossingDisposition | null =>
    typeof v === 'string' && DISPOSITION_VALUES.has(v)
      ? (v as BoundaryCrossingDisposition)
      : null
  const to = 'to' in p ? norm(p.to) : norm(p.disposition)
  return { from: norm(p.from), to }
}

/** LUM-769: the surface a disposition activity came through. Only the CLI path
 *  (and the LUM-772 system backfill) stamps `channel`; every row without it
 *  (web clicks, legacy rows) is WEB. */
function readChannel(payload: unknown): DispositionChannel {
  const p = (payload ?? {}) as Record<string, unknown>
  if (p.channel === 'CLI') return 'CLI'
  if (p.channel === 'SYSTEM') return 'SYSTEM'
  return 'WEB'
}

/**
 * LUM-769: the channel of the LATEST disposition activity on a crossing —
 * initial disposition or correction alike. Rows arrive oldest-first; null when
 * no activity was ever written (system dispositions such as AUTO_LEGIT or a
 * repository rule record none). Pure.
 */
export function latestDispositionChannel(
  rows: DispositionActivityRow[]
): DispositionChannel | null {
  const last = rows[rows.length - 1]
  return last ? readChannel(last.payload) : null
}

/**
 * The latest *correction* among a crossing's disposition activities (LUM-450):
 * the most recent change whose `from` is non-null — i.e. it changed an existing
 * disposition (re-classified or reverted to open), not the initial disposition.
 * Rows arrive oldest-first; null when the crossing was dispositioned at most
 * once. Pure.
 */
export function lastDispositionChange(
  rows: DispositionActivityRow[]
): DispositionChangeView | null {
  let latest: DispositionChangeView | null = null
  for (const row of rows) {
    const { from, to } = readTransition(row.payload)
    if (from === null) continue // an initial disposition is not a correction
    latest = {
      from,
      to,
      actorId: row.actorId,
      at: iso(row.createdAt) ?? '',
      channel: readChannel(row.payload),
    }
  }
  return latest
}

/** LUM-769: one 409 per receipt failure, naming the step that must run next. */
/** LUM-780: what the panel / CLI show for a re-judged advisory crossing. */
export interface RejudgeView {
  reason: string
  evidence: string
  criterionVersion: string | null
  at: string
}

/** A BOUNDARY_CROSSING_REJUDGED activity row as the read model folds it. */
export interface RejudgeActivityRow {
  payload: unknown
  createdAt: Date
}

/**
 * LUM-780: the LATEST re-judge trail per crossing, folded from the task's
 * BOUNDARY_CROSSING_REJUDGED activities (oldest-first). Malformed rows (no
 * crossing id / no reason) are skipped — a missing trail renders as "not
 * re-judged", never as a fabricated reason. Pure.
 */
export function latestRejudgeByCrossing(
  rows: RejudgeActivityRow[]
): Map<string, RejudgeView> {
  const out = new Map<string, RejudgeView>()
  for (const row of rows) {
    const p = (row.payload ?? {}) as Record<string, unknown>
    const id = p.boundaryCrossingId
    const reason = p.reason
    if (typeof id !== 'string' || typeof reason !== 'string') continue
    out.set(id, {
      reason,
      evidence: typeof p.evidence === 'string' ? p.evidence : '',
      criterionVersion:
        typeof p.criterionVersion === 'string' ? p.criterionVersion : null,
      at: iso(row.createdAt) ?? '',
    })
  }
  return out
}

/** Descending prominence — higher = more severe, surfaced first (LUM-442). */
const SEVERITY_RANK: Record<BoundaryCrossingSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

export const boundaryCrossingService = {
  /**
   * Whether the workspace's DONE gate is enabled (LUM-426 toggle). Surfaced on
   * the list read model (LUM-635) so the web panel can compute the blocking
   * subset exactly as the gate does: with the gate opted out only HIGH open
   * crossings still block (LUM-442). Read-only pass-through.
   */
  async isGateEnabled(workspaceId: string): Promise<boolean> {
    return boundaryCrossingRepository.isGateEnabledForWorkspace(workspaceId)
  },

  /**
   * List ALL of a task's crossings (open and dispositioned), shaped for the web
   * panel (LUM-435). Dispositioned crossings — CONFIRMED especially — stay on
   * record and are never hidden. Read-only: reads aren't the redline; the
   * disposition write is human-only.
   */
  async listAll(taskId: string): Promise<BoundaryCrossingView[]> {
    const rows = await boundaryCrossingRepository.findAllByTask(taskId)

    // Disposition-change history (LUM-450), grouped per crossing, so the read
    // model can mark a crossing as *corrected* (from -> to, by whom) rather than
    // a silent swap. One read for the whole task; folded in memory.
    const changeRows =
      await activityRepository.listDispositionChangesByTask(taskId)
    // LUM-780: the re-judge trail — why an advisory row no longer blocks.
    const rejudgeByCrossing = latestRejudgeByCrossing(
      await activityRepository.listByTaskAndType(
        taskId,
        'BOUNDARY_CROSSING_REJUDGED'
      )
    )
    const changesByCrossing = new Map<string, DispositionActivityRow[]>()
    for (const row of changeRows) {
      const id = (row.payload as { boundaryCrossingId?: unknown } | null)
        ?.boundaryCrossingId
      if (typeof id !== 'string') continue
      const list = changesByCrossing.get(id) ?? []
      list.push(row)
      changesByCrossing.set(id, list)
    }

    // Only display-safe crossings (TEST_TAMPERING) surface an inline edit-change.
    // Gather their linked hook-event ids and, once, the task's PR url for the
    // fallback — both fetches are skipped entirely when no such crossing exists.
    const safeRows = rows.filter(c =>
      EDIT_CONTENT_SAFE_CATEGORIES.has(c.category)
    )
    const eventIds = safeRows
      .map(c => c.hookEventId)
      .filter((id): id is string => !!id)
    const events =
      eventIds.length > 0
        ? await hookEventRepository.findManyByIdsForEditChange(eventIds)
        : []
    const eventById = new Map(events.map(e => [e.id, e]))
    const prUrl =
      safeRows.length > 0
        ? ((await pullRequestRepository.findByTaskId(taskId))?.url ?? null)
        : null

    // Attribution (LUM-469): for EVERY crossing (not just display-safe), resolve
    // who/which-agent/which-model from its linked hook event + the turn's
    // usageByModel. Read-only/additive — two id-scoped reads, both skipped when
    // no crossing carries a linked event. Model degrades to unknown (null), never
    // fabricated. Kept independent of the edit-change fetch above (that one is
    // safe-rows-only) so this audit path covers secret-bearing crossings too,
    // without ever routing their content (no payload field is surfaced here).
    const attribEventIds = rows
      .map(c => c.hookEventId)
      .filter((id): id is string => !!id)
    const attribEvents =
      attribEventIds.length > 0
        ? await hookEventRepository.findManyByIdsForAttribution(attribEventIds)
        : []
    const attribEventById = new Map(attribEvents.map(e => [e.id, e]))
    const attribSessionIds = [
      ...new Set(
        attribEvents.map(e => e.sessionId).filter((id): id is string => !!id)
      ),
    ]
    const usageStops =
      attribSessionIds.length > 0
        ? await hookEventRepository.findTurnUsageForSessions(attribSessionIds)
        : []

    // Turn-intent (LUM-455 / LUM-590): the summary of the turn each edit or
    // project-rule crossing belongs to — the closest proxy for a per-event reason.
    // LUM-590: expand session coverage to include attrib event sessions (not just
    // display-safe edit sessions) so agentContext resolves for PROJECT_RULE_VIOLATION
    // crossings that have a hook event but are not in the EDIT_CONTENT_SAFE set.
    const sessionIds = [
      ...new Set([
        ...events.map(e => e.sessionId).filter((id): id is string => !!id),
        ...attribEvents
          .map(e => e.sessionId)
          .filter((id): id is string => !!id),
      ]),
    ]
    const turnStops =
      sessionIds.length > 0
        ? await hookEventRepository.findTurnSummariesForSessions(sessionIds)
        : []

    // LUM-511: crossings recorded from a CLI path (spinoff laundering) carry no
    // hook event but do carry the originating sessionId — attribute them through
    // the Session directly (owner/agent/worktree + dominant model from cumulative
    // usageByModel). One id-scoped read, skipped when no such crossing exists.
    const directSessionIds = [
      ...new Set(
        rows
          .filter(c => !c.hookEventId && c.sessionId)
          .map(c => c.sessionId)
          .filter((id): id is string => !!id)
      ),
    ]
    const directSessions =
      directSessionIds.length > 0
        ? await sessionRepository.findManyForAttribution(directSessionIds)
        : []
    const directSessionById = new Map(directSessions.map(s => [s.id, s]))

    // LUM-542: append-only agent explanations for every crossing, grouped per
    // crossing in memory. One id-scoped read; skipped when the task has no
    // crossings. Each note is sanitized at this render boundary.
    const explanationRows =
      rows.length > 0
        ? await boundaryCrossingRepository.listExplanationsByCrossingIds(
            rows.map(c => c.id)
          )
        : []
    const explanationsByCrossing = new Map<string, ExplanationView[]>()
    for (const e of explanationRows) {
      const list = explanationsByCrossing.get(e.crossingId) ?? []
      list.push({
        id: e.id,
        note: sanitizeField(e.note),
        authorAgent: e.authorAgent,
        authorSessionId: e.authorSessionId,
        createdAt: iso(e.createdAt) ?? '',
      })
      explanationsByCrossing.set(e.crossingId, list)
    }

    const views = rows.map(c => {
      const rt = c.remediationTask
      const remediationTask: RemediationTaskView | null = rt
        ? {
            identifier: `${rt.team.identifier}-${rt.number}`,
            title: rt.title,
            status: rt.status,
            remediated: rt.status === 'DONE',
          }
        : null
      const linkedEvent = c.hookEventId
        ? (eventById.get(c.hookEventId) ?? null)
        : null
      const editChange = EDIT_CONTENT_SAFE_CATEGORIES.has(c.category)
        ? buildEditChangeView(
            c.category,
            linkedEvent,
            prUrl,
            filePathFromDetail(c.detail),
            turnContextForEvent(linkedEvent, turnStops)
          )
        : null
      const attribEvent = c.hookEventId
        ? (attribEventById.get(c.hookEventId) ?? null)
        : null
      // Hook event wins; otherwise fall back to the originating session
      // (LUM-511 — hook-less CLI crossings). All-null when neither resolves.
      const attribution = attribEvent
        ? buildAttributionView(
            attribEvent,
            modelForEvent(attribEvent, usageStops)
          )
        : c.sessionId
          ? attributionFromSession(directSessionById.get(c.sessionId) ?? null)
          : buildAttributionView(null, null)
      return {
        id: c.id,
        ref: formatCrossingRef(c.task?.team.identifier, c.number, c.id),
        category: c.category,
        detail: c.detail,
        detectedAt: iso(c.detectedAt) ?? '',
        // LUM-477: recurrence signal. lastSeenAt is null until the crossing first
        // recurs (and on legacy rows) — fall back to detectedAt so the bar always
        // has a "last seen" timestamp.
        occurrenceCount: c.occurrenceCount ?? 1,
        lastSeenAt: iso(c.lastSeenAt) ?? iso(c.detectedAt) ?? '',
        reversible: c.reversible,
        severity: c.severity,
        disposition: c.disposition,
        dispositionNote: c.dispositionNote,
        dispositionedAt: iso(c.dispositionedAt),
        dispositionedById: c.dispositionedById,
        // LUM-769: the surface of the current ruling; null while open or when
        // the ruling was a system one that wrote no activity row.
        dispositionChannel: c.disposition
          ? latestDispositionChannel(changesByCrossing.get(c.id) ?? [])
          : null,
        remediationTask,
        editChange,
        lastDispositionChange: lastDispositionChange(
          changesByCrossing.get(c.id) ?? []
        ),
        attribution,
        explanations: explanationsByCrossing.get(c.id) ?? [],
        triageProbability: c.triageProbability ?? null,
        triageModel: c.triageModel ?? null,
        // LUM-590: advisory and policyRuleRef straight from the row.
        advisory: c.advisory,
        rejudge: rejudgeByCrossing.get(c.id) ?? null,
        policyRuleRef: c.policyRuleRef ?? null,
        // LUM-590: frozen rule text and turn-level agent intent for the three-field
        // display. policyRuleText is the verbatim rule text stored at detection time.
        // agentContext reuses the attrib event (covers all hook-sourced crossings,
        // not just display-safe ones) — best-effort; null when unresolvable.
        policyRuleText: c.policyRuleText ?? null,
        agentContext: attribEvent
          ? turnContextForEvent(
              // turnContextForEvent only reads sessionId + createdAt; attribEvent
              // carries both. toolName is not used by the function — cast to satisfy
              // the type without fabricating a value.
              { ...attribEvent, toolName: null },
              turnStops
            )
          : null,
        // LUM-590: cached system-generated explanation; null = not yet generated.
        systemExplanation: c.systemExplanation ?? null,
        // LUM-751: repository-rule affordances.
        suppressible:
          isSuppressibleCategory(c.category) &&
          c.target != null &&
          !c.rawPurgedAt,
        suppressionDirectory:
          isSuppressibleCategory(c.category) && !c.rawPurgedAt
            ? suppressionDirectory(c.category, c.target)
            : null,
        // LUM-912: the raw text was replaced by a code-free description.
        rawPurged: c.rawPurgedAt != null,
        suppressionRule: c.suppressionRule
          ? {
              id: c.suppressionRule.id,
              reason: c.suppressionRule.reason ?? null,
              revokedAt: iso(c.suppressionRule.revokedAt),
            }
          : null,
      }
    })
    // Surface by severity (LUM-442) — HIGH first. Stable: the repository already
    // returns detectedAt-ascending, so ties keep chronological order within a tier.
    return views.sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    )
  },

  /**
   * Disposition — or RE-disposition (LUM-450) — a boundary-crossing. The
   * human-only half of the gate (LUM-435, mirrors LUM-422/426): the route guard
   * refuses bearer identities before parse, so this service is only ever reached
   * by a Clerk human. The `target` is the new state: FALSE_POSITIVE | CONFIRMED
   * (either clears the DONE block for that crossing) or `null` to revert the
   * crossing back to OPEN (undispositioned), which re-blocks DONE. The note is
   * optional.
   *
   * Re-disposition overwrites the CURRENT state and is fully auditable: every
   * real change (from -> to) appends its own BOUNDARY_CROSSING_DISPOSITIONED
   * activity — append-only, so prior history is never erased and the change
   * trail is recoverable from the task timeline (criterion 2). Idempotent: when
   * the target equals the current value nothing is written and no redundant
   * audit row is emitted, preserving the original reviewer/timestamp.
   *
   * Who may reach this service (LUM-769 supersedes the "web-only" half of the
   * red line): the web route (Clerk human, `channel` absent → WEB) and the
   * task-scoped CLI route (bearer, `channel: 'CLI'`), which the CLI only calls
   * after walking the exit-4 confirmation protocol — the agent relays the
   * envelope, the user approves in chat, and the agent re-runs with --confirm.
   * That approval is unverifiable server-side, so the channel is stamped on the
   * audit row and the read model surfaces it. What stays web-only: the OPEN
   * revert and the LUM-751 suppression opt-in (the CLI schema cannot carry
   * either).
   */
  async disposition(
    taskId: string,
    crossingId: string,
    target: BoundaryCrossingDisposition | null,
    note: string | null,
    attribution: DispositionAttribution,
    options: DispositionOptions = {}
  ): Promise<DispositionOutcome> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    // LUM-751: a FALSE_POSITIVE may opt the whole repository out of this
    // (category, target) shape. Checked and written BEFORE the disposition so a
    // refused rule (HIGH class / no target) leaves the crossing untouched. The
    // rule is keyed on the crossing's own coalescing target — the same key the
    // detector matches on — and attributed to the human member who ruled.
    let suppressionRuleId: string | null = null
    let retroactivelySuppressed = 0
    let retroactiveCapped = false
    // Resolved lazily and at most once: the rule sweep needs the Actor for its
    // audit rows, and so does the disposition write below.
    let resolvedActorId: string | null = null
    let actorResolved = false
    const actorId = async () => {
      if (!actorResolved) {
        const actor = await memberRepository.findActorByMemberId(
          attribution.actorMemberId
        )
        resolvedActorId = actor?.id ?? null
        actorResolved = true
      }
      return resolvedActorId
    }
    if (options.suppressSimilarInProject && target === 'FALSE_POSITIVE') {
      if (!isSuppressibleCategory(crossing.category)) {
        throw Object.assign(
          new Error(
            `${crossing.category} crossings cannot be rule-suppressed — this class always needs a human decision`
          ),
          { status: 422 }
        )
      }
      // LUM-912: a purged crossing's target is a hash — a rule built from it
      // would never match a new detection.
      if (!crossing.target || crossing.rawPurgedAt) {
        throw Object.assign(
          new Error(
            'This crossing has no coalescing target to build a repository rule from'
          ),
          { status: 422 }
        )
      }
      // LUM-963: the scope decides how wide the rule reaches; a scope this
      // crossing cannot carry (not a path category, or a too-broad directory)
      // is refused before anything is written.
      const targetPattern = suppressionPatternFor(
        crossing.category,
        crossing.target,
        options.suppressionScope ?? 'exact'
      )
      if (targetPattern == null) {
        throw Object.assign(
          new Error(
            'A directory-wide rule cannot be built from this crossing (path categories only, and never over /, ~ or a top-level directory)'
          ),
          { status: 422 }
        )
      }
      const task = await taskRepository.findWithProject(taskId)
      if (!task) {
        throw Object.assign(new Error('Task not found'), { status: 404 })
      }
      // LUM-759: the rule is created AND applied backwards in one transaction
      // — every existing open crossing of the same shape in this project is
      // stamped with it. Before 759 a rule only bound future detections, so
      // ruling once still left every already-recorded occurrence in the queue.
      const created =
        await crossingSuppressionRuleRepository.createWithRetroactiveSweep(
          {
            projectId: task.projectId,
            category: crossing.category,
            targetPattern,
            reason: options.suppressionReason ?? null,
            createdById: attribution.actorMemberId,
            sourceCrossingId: crossingId,
          },
          {
            limit: RETROACTIVE_SUPPRESSION_CAP,
            actorId: await actorId(),
            now: new Date(),
          }
        )
      suppressionRuleId = created.id
      retroactivelySuppressed = created.suppressedCount
      retroactiveCapped = created.capped
    }

    const from = crossing.disposition

    // LUM-907: the workspace audit log gets one row per ruling that changed
    // something — the transition, and the repository rule it created, if any.
    // Ids, category and enum values only; the crossing detail and the note
    // stay on the task timeline.
    const recordRuling = async (changed: boolean) => {
      if (!changed && !suppressionRuleId) return
      await recordAuditEvent({
        workspaceId: attribution.audit.workspaceId,
        action: 'boundary_crossing.dispositioned',
        target: { type: 'boundary_crossing', id: crossingId },
        metadata: {
          taskId,
          category: crossing.category,
          from,
          to: target,
          channel: attribution.channel ?? 'WEB',
          ...(suppressionRuleId
            ? { suppressionRuleId, retroactivelySuppressed }
            : {}),
        },
        context: attribution.audit.context,
      })
    }

    // No-op when the disposition isn't actually changing — keeps the original
    // reviewer/timestamp and emits no redundant audit row (idempotent).
    if (from === target) {
      await recordRuling(false)
      return {
        crossingId,
        disposition: target,
        ...(suppressionRuleId
          ? { suppressionRuleId, retroactivelySuppressed, retroactiveCapped }
          : {}),
      }
    }

    const writerActorId = await actorId()

    await boundaryCrossingRepository.disposition(
      crossingId,
      target,
      note,
      writerActorId,
      new Date()
    )
    // Append-only audit of THIS change. `from`/`to` carry the transition (null
    // = OPEN on either side); `disposition` mirrors the new value for back-compat
    // with existing timeline readers. A later change appends another row — it
    // never rewrites this one (criterion 2).
    await activityRepository.create({
      taskId,
      actorId: writerActorId,
      type: 'BOUNDARY_CROSSING_DISPOSITIONED',
      payload: {
        boundaryCrossingId: crossingId,
        category: crossing.category,
        detail: crossing.detail,
        from,
        to: target,
        disposition: target,
        note: note ?? null,
        // LUM-751: the repository rule created with this ruling, if any.
        ...(suppressionRuleId ? { suppressionRuleId } : {}),
        // LUM-769: stamped only on the CLI path, so a web ruling's payload keeps
        // its pre-769 shape and the two stay distinguishable in the audit trail.
        // The handshake timestamps make the process auditable like a terms
        // acceptance: shown at readAt, read acknowledged at readAcknowledgedAt,
        // ruling confirmed at confirmedAt.
        ...(attribution.channel === 'CLI'
          ? {
              channel: 'CLI',
              ...(attribution.handshake
                ? {
                    readAt: attribution.handshake.readAt,
                    readAcknowledgedAt:
                      attribution.handshake.readAcknowledgedAt,
                    confirmedAt: new Date().toISOString(),
                  }
                : {}),
            }
          : {}),
      },
    })

    await recordRuling(true)

    // Additive: the rule id rides along only when one was created, so existing
    // callers and their assertions see the pre-751 shape otherwise.
    return {
      crossingId,
      disposition: target,
      ...(suppressionRuleId
        ? { suppressionRuleId, retroactivelySuppressed, retroactiveCapped }
        : {}),
    }
  },

  /**
   * LUM-769 read receipt — the READ half of the CLI disposition handshake.
   * Signs the crossing as it stands right now (state hash over disposition,
   * recurrence, explanations, detail…) for one ruling and one caller, and
   * hands back a short token. Writes nothing. 404 off-task, 503 when no
   * signing secret is configured (fail closed: no receipt → no CLI ruling).
   */
  async issueReadReceipt(
    taskId: string,
    crossingId: string,
    target: 'FALSE_POSITIVE' | 'CONFIRMED',
    caller: ReceiptCaller
  ): Promise<IssuedReceipt> {
    const subject = await this.receiptSubject(
      taskId,
      crossingId,
      target,
      caller
    )
    return issueReadReceipt(this.requireReceiptSecret(), subject)
  },

  /**
   * LUM-769 read receipt — stage 2, "the user confirmed they read it". Verifies
   * the stage-1 receipt against the crossing as it is NOW and issues the
   * stage-2 receipt the write step requires. Writes nothing. 409 on a forged,
   * expired, foreign or stale stage-1 receipt.
   */
  async acknowledgeReadReceipt(
    taskId: string,
    crossingId: string,
    target: 'FALSE_POSITIVE' | 'CONFIRMED',
    receipt: string,
    caller: ReceiptCaller
  ): Promise<IssuedReceipt> {
    const subject = await this.receiptSubject(
      taskId,
      crossingId,
      target,
      caller
    )
    const out = acknowledgeReadReceipt(
      this.requireReceiptSecret(),
      receipt,
      subject
    )
    if (out.ok) return out.issued
    throw receiptRefusal(out, '--confirm-read')
  },

  /**
   * LUM-769 read receipt — the WRITE-side check. Recomputes the subject from
   * the request context and the crossing's CURRENT state and verifies a
   * STAGE-2 receipt: a stage-1 receipt (read, never acknowledged) is refused
   * with "confirm read first"; a forged, expired, foreign or stale receipt is
   * refused too. Every refusal is a 409 and nothing is written. Returns the
   * handshake timestamps for the audit row.
   */
  async verifyReadReceipt(
    taskId: string,
    crossingId: string,
    target: 'FALSE_POSITIVE' | 'CONFIRMED',
    receipt: string,
    caller: ReceiptCaller
  ): Promise<{ readAt: string; readAcknowledgedAt: string }> {
    const subject = await this.receiptSubject(
      taskId,
      crossingId,
      target,
      caller
    )
    const verdict = verifyReadReceipt(
      this.requireReceiptSecret(),
      receipt,
      subject,
      new Date(),
      { requireStage: 'ACK' }
    )
    if (verdict.ok) {
      return {
        readAt: verdict.readAt,
        readAcknowledgedAt: verdict.readAcknowledgedAt ?? verdict.readAt,
      }
    }
    throw receiptRefusal(verdict, '--confirm')
  },

  /** Shared by issue/verify so both sides hash exactly the same state. */
  async receiptSubject(
    taskId: string,
    crossingId: string,
    target: 'FALSE_POSITIVE' | 'CONFIRMED',
    caller: ReceiptCaller
  ): Promise<ReceiptSubject> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }
    const explanations =
      await boundaryCrossingRepository.listExplanationsByCrossingIds([
        crossingId,
      ])
    return {
      // LUM-812: the handshake is shared with the test-case defect plane, so
      // the subject carries its kind — a crossing receipt can never be replayed
      // against a defect ruling.
      kind: 'CROSSING',
      subjectId: crossingId,
      taskId,
      target,
      sessionId: caller.sessionId,
      memberId: caller.memberId,
      stateHash: crossingStateHash({
        disposition: crossing.disposition,
        occurrenceCount: crossing.occurrenceCount ?? 1,
        lastSeenAt: crossing.lastSeenAt,
        detectedAt: crossing.detectedAt,
        severity: crossing.severity,
        category: crossing.category,
        detail: crossing.detail,
        explanationIds: explanations.map(e => e.id),
      }),
    }
  },

  requireReceiptSecret(): string {
    const secret = readReceiptSecret()
    if (!secret) {
      throw Object.assign(
        new Error(
          'Read-receipt signing is not configured on this server (LUMO_RECEIPT_SECRET / CRON_SECRET) — CLI dispositions are unavailable; use the web panel'
        ),
        { status: 503 }
      )
    }
    return secret
  },

  /**
   * LUM-751: soft-revoke a repository suppression rule from a task in the
   * rule's project. Human-only (the route refuses bearer identities before
   * anything is read); the row is kept for audit — there is no delete path.
   * Idempotent: an already-revoked rule returns its original revokedAt.
   */
  async revokeSuppressionRule(
    taskId: string,
    ruleId: string,
    attribution: DispositionAttribution
  ): Promise<{ ruleId: string; revokedAt: string; reopenedCount: number }> {
    const [task, rule] = await Promise.all([
      taskRepository.findWithProject(taskId),
      crossingSuppressionRuleRepository.findById(ruleId),
    ])
    if (!task || !rule || rule.projectId !== task.projectId) {
      throw Object.assign(
        new Error("Suppression rule not found for this task's project"),
        { status: 404 }
      )
    }
    if (rule.revokedAt) {
      // Idempotent: the first revoke already reopened what it had suppressed,
      // and re-running must not reopen a crossing dispositioned since then.
      return {
        ruleId,
        revokedAt: rule.revokedAt.toISOString(),
        reopenedCount: 0,
      }
    }
    const now = new Date()
    const actor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    // LUM-759: revoking undoes what the rule silenced, in the same transaction
    // as the soft revoke — otherwise taking a rule back would only bind the
    // future while everything it already suppressed stayed suppressed.
    const { reopenedCount } =
      await crossingSuppressionRuleRepository.revokeWithRestore(
        ruleId,
        attribution.actorMemberId,
        actor?.id ?? null,
        now
      )
    await recordAuditEvent({
      workspaceId: attribution.audit.workspaceId,
      action: 'boundary_crossing.suppression_rule_revoked',
      target: { type: 'suppression_rule', id: ruleId },
      metadata: {
        taskId,
        projectId: rule.projectId,
        reopenedCount,
      },
      context: attribution.audit.context,
    })
    return { ruleId, revokedAt: now.toISOString(), reopenedCount }
  },

  /**
   * LUM-759 — read-only: how many existing crossings a rule built from this
   * crossing would dispose right now. Shown in the panel next to the opt-in so
   * the human sees the blast radius BEFORE committing the ruling. Writes
   * nothing, and deliberately runs the same predicate the sweep does, so the
   * number shown is the number that gets stamped.
   */
  async previewSuppressionScope(
    taskId: string,
    crossingId: string,
    // LUM-963: preview the rule the human is about to pick, not always the
    // exact one — a directory rule's blast radius is the point of the preview.
    scope: SuppressionScope = 'exact'
  ): Promise<SuppressionScopePreview> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        {
          status: 404,
        }
      )
    }
    const base = {
      count: 0,
      capped: false,
      cap: RETROACTIVE_SUPPRESSION_CAP,
    }
    if (
      !isSuppressibleCategory(crossing.category) ||
      !crossing.target ||
      crossing.rawPurgedAt
    ) {
      return { ...base, suppressible: false }
    }
    const targetPattern = suppressionPatternFor(
      crossing.category,
      crossing.target,
      scope
    )
    if (targetPattern == null) return { ...base, suppressible: false }
    const task = await taskRepository.findWithProject(taskId)
    if (!task) throw Object.assign(new Error('Task not found'), { status: 404 })

    const matches =
      await boundaryCrossingRepository.countRetroactiveSuppressionCandidates({
        projectId: task.projectId,
        category: crossing.category,
        targetPattern,
        excludeCrossingId: crossingId,
      })
    return {
      suppressible: true,
      count: Math.min(matches, RETROACTIVE_SUPPRESSION_CAP),
      capped: matches > RETROACTIVE_SUPPRESSION_CAP,
      cap: RETROACTIVE_SUPPRESSION_CAP,
    }
  },

  /**
   * Record an append-only agent self-explanation ("申辩") on a crossing
   * (LUM-542). This is the deliberate INVERSE of {@link disposition}: it is an
   * agent/CLI write path, but it can only ever APPEND a note — it never reads or
   * writes `disposition`, so an agent still cannot clear its own crossing or
   * unblock its own DONE gate. The note is a reviewer aid + retrospective record.
   *
   * Scope guard: the crossing must belong to `taskId` (else 404), and when an
   * originating session is supplied the write is allowed only if (LUM-932):
   *  (a) the session's effective explicit binding (a subagent child falls back
   *      to its parent) is this task; or
   *  (b) the session family is not explicitly bound, is not a STEWARD, and the
   *      crossing was recorded by that same family (same root session) — an
   *      unattached session explaining crossings from its own work, which P3
   *      records on its inferred task.
   * Otherwise 403: bound to a different task, STEWARD, or an unattached caller
   * reaching into another session family. A missing session id (non-Claude-Code
   * caller) is allowed through on the task/workspace scope alone and recorded
   * as null.
   *
   * Append-only: every call inserts a fresh row; an earlier explanation is never
   * modified or removed, so a correction is additive and prior wording survives.
   */
  async explain(
    taskId: string,
    crossingId: string,
    note: string,
    attribution: {
      authorSessionId?: string | null
      authorAgent?: string | null
      memberId?: string | null
    }
  ): Promise<ExplainOutcome> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    // Scope: an agent may only explain a crossing on the task its session is
    // bound to. When a session id is present we enforce the binding; absent (a
    // non-CC bearer caller) we fall back to the route's task/workspace scope.
    const sessionId = attribution.authorSessionId ?? null
    if (sessionId) {
      const effective = attribution.memberId
        ? await resolveEffectiveBindingSession(sessionId, attribution.memberId)
        : null
      const familyRoot = (id: string) =>
        parseChildSessionId(id)?.parentSessionId ?? id
      const boundHere = effective?.task?.id === taskId
      const unattachedCaller =
        !!effective && !effective.task && effective.role !== 'STEWARD'
      // A hook-originated (detector) crossing records only its hook event;
      // its session is the event's.
      const crossingSessionId =
        !boundHere && unattachedCaller
          ? (crossing.sessionId ??
            (crossing.hookEventId
              ? await hookEventRepository.findSessionId(crossing.hookEventId)
              : null))
          : null
      const unattachedOwnWork =
        unattachedCaller &&
        !!crossingSessionId &&
        familyRoot(crossingSessionId) === familyRoot(sessionId)
      if (!boundHere && !unattachedOwnWork) {
        throw Object.assign(
          new Error(
            'A session can only explain a boundary-crossing on the task it is bound to, or one from its own work while unattached'
          ),
          { status: 403 }
        )
      }
    }

    const row = await boundaryCrossingRepository.createExplanation({
      crossingId,
      note,
      authorSessionId: sessionId,
      authorAgent: attribution.authorAgent ?? null,
    })

    return {
      crossingId,
      explanation: {
        id: row.id,
        note: sanitizeField(row.note),
        authorAgent: row.authorAgent,
        authorSessionId: row.authorSessionId,
        createdAt: iso(row.createdAt) ?? '',
      },
    }
  },

  /**
   * Build the one-time agent reminder for a task's freshly-detected crossings
   * (LUM-542). Returns reminder text for every OPEN crossing the agent hasn't
   * been told about yet, and stamps `agentNotifiedAt` so it fires exactly once
   * per crossing — a later hook for the same crossing produces nothing. Returns
   * null when there is nothing new to surface (the common case, so the hot
   * pre-tool-use path stays cheap). The text is built from our own strings plus
   * enum-safe id/category/severity — the CLI sanitizes it before stdout anyway.
   *
   * Discovery only: it points the agent at `lumo crossing explain` and is
   * explicit that an explanation is an append-only note, never a disposition.
   */

  /**
   * Generate (or return cached) a SYSTEM plain-language explanation for a
   * boundary crossing (LUM-590). Human-only: called from the web panel "Explain"
   * button; the route guard refuses bearer/agent identities. ADVISORY ONLY —
   * this has zero effect on disposition or the DONE gate.
   *
   * Cache semantics: if `systemExplanation` is already set on the crossing,
   * return it immediately (CACHE HIT — no LLM call). Otherwise: load fields via
   * `findForExplanation`, derive `agentContext` the same way `listAll` does
   * (reuse `turnContextForEvent`), dynamic-import the LLM client, call it,
   * persist the result via `setSystemExplanation`, and return it. On LLM
   * failure, throw a clean error (the route maps to 502) — never persist a bad
   * value.
   */
  async explainCrossing(
    taskId: string,
    crossingId: string
  ): Promise<{ explanation: string }> {
    const row = await boundaryCrossingRepository.findForExplanation(crossingId)
    if (!row || row.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    // LUM-912: nothing left to explain from — the raw text was not retained.
    if (row.rawPurgedAt) {
      throw Object.assign(
        new Error('The original text of this crossing was not retained'),
        { status: 409 }
      )
    }

    // CACHE HIT — return stored explanation without calling the LLM.
    if (row.systemExplanation) {
      return { explanation: row.systemExplanation }
    }

    // LUM-1063: the explanation is a plugin's (`crossingExplainer`); without
    // one this server cannot generate it — 501, nothing persisted.
    const explainer = crossingExplainer()
    if (!explainer) {
      throw Object.assign(
        new Error(
          'System explanations are not available on this server (no explainer plugin is installed)'
        ),
        { status: 501 }
      )
    }

    // Derive agentContext: load the attrib event + turn stops, mirror listAll.
    // Best-effort — null is acceptable if the session/event can't be resolved.
    // Re-use findById (SELECT) which includes hookEventId not in EXPLAIN_SELECT.
    let agentContext: string | null = null
    try {
      const crossing = await boundaryCrossingRepository.findById(crossingId)
      const hookEventId =
        (crossing as { hookEventId?: string | null } | null)?.hookEventId ??
        null
      if (hookEventId) {
        const attribEvents =
          await hookEventRepository.findManyByIdsForAttribution([hookEventId])
        const attribEvent = attribEvents[0] ?? null
        if (attribEvent?.sessionId) {
          const turnStops =
            await hookEventRepository.findTurnSummariesForSessions([
              attribEvent.sessionId,
            ])
          agentContext = turnContextForEvent(
            { ...attribEvent, toolName: null },
            turnStops
          )
        }
      }
    } catch {
      // agentContext degrades to null — do not block explanation generation.
    }

    let result: { explanation: string }
    try {
      result = await explainer.explain({
        rule: row.policyRuleText ?? null,
        evidence: row.detail,
        category: row.category,
        severity: row.severity,
        agentContext,
      })
    } catch (cause) {
      throw Object.assign(
        new Error('Failed to generate explanation: LLM call failed'),
        { status: 502, cause }
      )
    }

    // Persist for future cache hits. LUM-904: the repository stores it
    // redacted — hand back that stored form so the first read matches every
    // cached one.
    const stored = await boundaryCrossingRepository.setSystemExplanation(
      crossingId,
      result.explanation
    )

    return { ...result, explanation: stored.systemExplanation ?? '' }
  },

  /**
   * One-time agent reminder for freshly-detected crossings (LUM-542). Advisory
   * crossings never block DONE (LUM-590), so they are labelled as such and get
   * no explain/disposition guidance — otherwise the agent reads them as
   * blockers and pushes our noise onto the customer (LUM-897).
   */
  async buildAgentReminder(taskId: string): Promise<string | null> {
    const open =
      await boundaryCrossingRepository.findUnnotifiedOpenByTask(taskId)
    if (open.length === 0) return null
    await boundaryCrossingRepository.markAgentNotified(
      open.map(c => c.id),
      new Date()
    )
    const line = (c: (typeof open)[number]) =>
      `  • [${c.severity}] ${c.category} (${formatCrossingRef(
        c.task?.team?.identifier,
        c.number,
        c.id
      )})`
    const blocking = open.filter(c => !c.advisory)
    const advisory = open.filter(c => c.advisory)
    const plural = (n: number) => (n === 1 ? '' : 's')
    const advisoryHead =
      'Advisory — does NOT block DONE, no action needed (shown on the task for the record):'

    if (blocking.length === 0) {
      return [
        `ℹ Lumo recorded ${advisory.length} new advisory boundary crossing${plural(
          advisory.length
        )} from your recent actions. ${advisoryHead}`,
        ...advisory.map(line),
      ].join('\n')
    }

    // LUM-932: an unattached session has no binding to resolve the task from,
    // so the command carries it explicitly.
    const task = open[0]?.task
    const taskFlag = task?.team
      ? ` --task ${task.team.identifier}-${task.number}`
      : ''
    const guidance =
      'If you think one is a false positive — or want to leave a rationale for ' +
      `the human reviewer — run: lumo crossing explain <id>${taskFlag} --note "…". ` +
      'That note is append-only and for review only: it does NOT clear the ' +
      'crossing or unblock Done (a human dispositions that).'
    const head = `⚠ Lumo recorded ${open.length} new boundary crossing${plural(
      open.length
    )} from your recent actions:`
    if (advisory.length === 0) {
      return [head, ...blocking.map(line), guidance].join('\n')
    }
    return [
      head,
      'Blocking — blocks DONE until a human dispositions it:',
      ...blocking.map(line),
      advisoryHead,
      ...advisory.map(line),
      `For the blocking one${plural(blocking.length)} only: ${guidance.charAt(0).toLowerCase()}${guidance.slice(1)}`,
    ].join('\n')
  },

  /**
   * Spawn a remediation follow-up task from a crossing (LUM-435). Creates a
   * pre-linked TODO task, back-fills `remediationTaskId` on the crossing, and
   * adds a hard dependency edge (remediation blocked-by the original task — the
   * fix is a downstream follow-up, never reopening the original). This is a
   * normal authenticated write (NOT the human-only redline): spawning a task is
   * ordinary task creation, not a gate-clearing disposition. Idempotent — if the
   * crossing already links a remediation task, returns it without duplicating.
   */
  async spawnRemediation(
    taskId: string,
    crossingId: string,
    attribution: Omit<DispositionAttribution, 'audit'> & { workspaceId: string }
  ): Promise<SpawnRemediationOutcome> {
    const crossing = await boundaryCrossingRepository.findById(crossingId)
    if (!crossing || crossing.taskId !== taskId) {
      throw Object.assign(
        new Error('Boundary-crossing not found on this task'),
        { status: 404 }
      )
    }

    const original = await taskRepository.findWithProject(taskId)
    if (!original) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    // Idempotent: a crossing links at most one remediation task.
    if (crossing.remediationTaskId) {
      const existing = await taskRepository.findHeaderById(
        crossing.remediationTaskId
      )
      return {
        crossingId,
        remediationTaskId: crossing.remediationTaskId,
        remediationTaskIdentifier: existing
          ? `${existing.team.identifier}-${existing.number}`
          : crossing.remediationTaskId,
      }
    }

    const actor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = actor?.id ?? ''

    const { task: remediation } = await createTask(
      original.projectId,
      {
        title: `Remediate: ${crossing.category} — ${crossing.detail}`.slice(
          0,
          200
        ),
        status: 'TODO',
        priority: 'HIGH',
      },
      actorId,
      attribution.actorClerkId,
      attribution.actorMemberId,
      // LUM-1285: a remediation records a crossing that already happened, so
      // it lands even in a paused / canceled / archived project.
      { automation: true }
    )

    await boundaryCrossingRepository.setRemediationTask(
      crossingId,
      remediation.id
    )

    // Remediation blocked-by original: a downstream follow-up, never reopening it.
    await taskDependencyService.addManual({
      workspaceId: attribution.workspaceId,
      blockedTaskId: remediation.id,
      blockingTaskId: taskId,
      kind: 'BLOCKS',
    })

    await activityRepository.create({
      taskId,
      actorId,
      type: 'BOUNDARY_CROSSING_REMEDIATION_SPAWNED',
      payload: {
        boundaryCrossingId: crossingId,
        category: crossing.category,
        remediationTaskId: remediation.id,
      },
    })

    return {
      crossingId,
      remediationTaskId: remediation.id,
      remediationTaskIdentifier: `${remediation.teamIdentifier}-${remediation.number}`,
    }
  },
}
