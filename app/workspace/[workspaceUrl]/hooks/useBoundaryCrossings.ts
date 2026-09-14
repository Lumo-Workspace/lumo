'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

// AUTO_LEGIT (LUM-478) and AUTO_SUPPRESSED (LUM-751, a human-authored
// repository rule applied by the system) are SYSTEM dispositions the read model
// can surface; a human can only WRITE FALSE_POSITIVE | CONFIRMED | OPEN (see
// the api-client), never a system value.
export type BoundaryDisposition =
  | 'FALSE_POSITIVE'
  | 'CONFIRMED'
  | 'AUTO_LEGIT'
  | 'AUTO_SUPPRESSED'

/**
 * LUM-759: read-only blast radius of a rule the human has not created yet —
 * how many ALREADY-RECORDED alerts of the same kind in this repository the
 * rule would dispose alongside the crossing being ruled on.
 */
export interface SuppressionPreview {
  suppressible: boolean
  count: number
  capped: boolean
  cap: number
}

/** LUM-751: the repository rule behind an AUTO_SUPPRESSED disposition. */
export interface SuppressionRuleView {
  id: string
  reason: string | null
  /** Set once a human revoked the rule; future occurrences are open again. */
  revokedAt: string | null
}
export type BoundarySeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface RemediationTaskView {
  identifier: string
  title: string
  status: string
  remediated: boolean
}

/** Inline before→after of the edit that tripped a display-safe crossing (LUM-452). */
export interface EditChangeView {
  kind: 'edit' | 'write' | null
  oldText: string | null
  newText: string | null
  truncated: boolean
  unavailable: string | null
  prUrl: string | null
  /** Deep link to this file's diff inside the PR (LUM-455). */
  prFileUrl: string | null
  /** Turn-level intent the agent stated for the turn this edit belongs to (LUM-455). */
  agentTurnContext: string | null
}

/** Read-only attribution for a crossing (LUM-469): who/which-agent/which-model
 *  committed it. Every field is null when it couldn't be resolved (unknown). */
export interface CrossingAttributionView {
  workspaceMemberId: string | null
  sessionId: string | null
  agent: string | null
  worktreeBranch: string | null
  model: string | null
}

/** The latest re-disposition of a crossing (LUM-450): from -> to + who. */
export interface DispositionChangeView {
  from: BoundaryDisposition | null
  to: BoundaryDisposition | null
  actorId: string | null
  at: string
  /** LUM-769: `CLI` when the correction came through
   *  `lumo crossing disposition --confirm`, else `WEB`. */
  channel: DispositionChannel
}

/** LUM-769: the surface a ruling came through (mirrors the service type). */
export type DispositionChannel = 'WEB' | 'CLI'

export interface BoundaryCrossingView {
  id: string
  category: string
  detail: string
  detectedAt: string
  reversible: boolean
  /** How many detections coalesced into this crossing (LUM-477); 1 unless it
   *  recurred while open. */
  occurrenceCount: number
  /** When the crossing was last (re)detected (LUM-477); falls back to detectedAt. */
  lastSeenAt: string
  severity: BoundarySeverity
  disposition: BoundaryDisposition | null
  dispositionNote: string | null
  dispositionedAt: string | null
  dispositionedById: string | null
  remediationTask: RemediationTaskView | null
  editChange: EditChangeView | null
  /** Set when the crossing's disposition was corrected (re-dispositioned). */
  lastDispositionChange: DispositionChangeView | null
  /** LUM-769: which surface the current ruling came through — `CLI` for
   *  `lumo crossing disposition --confirm` (user approval relayed by the agent,
   *  unverifiable server-side), `WEB` for a panel click; null while open or for
   *  system rulings that wrote no activity row. */
  dispositionChannel?: DispositionChannel | null
  /** Who/what crossed (LUM-469) — owner, agent/session, model. Always present. */
  attribution: CrossingAttributionView
  /** LUM-542: append-only agent self-explanations ("申辩"), oldest-first; each
   *  note is sanitized server-side. Empty when the agent recorded none. */
  explanations: ExplanationView[]
  /** LUM-590: advisory crossings surface in the panel but never block DONE
   *  (true = advisory / non-blocking). */
  advisory: boolean
  /** LUM-590: which compiled PolicyRule fired (text ref / id); null when the
   *  crossing was not from a project-rule detector. */
  policyRuleRef: string | null
  /** LUM-590: frozen verbatim text of the policy rule at detection time; null
   *  for non-project-rule crossings. */
  policyRuleText: string | null
  /** LUM-590: turn-level intent the agent stated for the turn containing this
   *  crossing; null when not derivable. */
  agentContext: string | null
  /** LUM-590: cached SYSTEM-generated plain-language explanation for this
   *  crossing; null = not yet generated (human must click "Explain"). ADVISORY
   *  ONLY — never changes disposition or the DONE gate. */
  systemExplanation: string | null
  /** LUM-751: the category may be rule-suppressed AND the crossing carries a
   *  coalescing target — the panel offers the per-repository opt-in only then. */
  suppressible?: boolean
  /** LUM-751: the rule that auto-dispositioned this crossing (AUTO_SUPPRESSED);
   *  null for every other crossing. Both fields are optional on the client so
   *  an older server response (or a fixture) still type-checks. */
  suppressionRule?: SuppressionRuleView | null
}

/** LUM-542: an append-only agent self-explanation on a crossing. */
export interface ExplanationView {
  id: string
  note: string
  authorAgent: string | null
  authorSessionId: string | null
  createdAt: string
}

interface BoundaryCrossingsResponse {
  crossings: BoundaryCrossingView[]
  /** LUM-635: the workspace DONE-gate toggle, so the panel can compute the
   *  blocking subset like the gate does (opt-out → only HIGH blocks). Absent
   *  on older server responses. */
  gateEnabled?: boolean
}

interface UseBoundaryCrossingsOptions {
  /** Task identifier (LUM-42); the route resolves it or a cuid. */
  identifier: string
  /** When false the hook neither fetches nor reads cache (tab inactive). */
  enabled?: boolean
}

/**
 * Read-through cache for ALL of a task's boundary-crossings — open and
 * dispositioned (LUM-435), consumed by the AcceptanceTab panel. Mirrors
 * useTaskStatus: once cached for `identifier`, tab switches paint instantly
 * while a quiet background refetch keeps it fresh.
 */
export function useBoundaryCrossings({
  identifier,
  enabled = true,
}: UseBoundaryCrossingsOptions) {
  const query = useQuery<BoundaryCrossingsResponse>({
    queryKey: queryKeys.boundaryCrossings(identifier),
    queryFn: () =>
      tasksClient.listBoundaryCrossings<BoundaryCrossingsResponse>(identifier),
    enabled: !!identifier && enabled,
  })

  return {
    crossings: query.data?.crossings ?? [],
    // Missing field (older server) defaults to true — the conservative
    // direction: treat open crossings as blocking rather than quietly not.
    gateEnabled: query.data?.gateEnabled ?? true,
    loading: query.isPending && !!identifier && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load boundary crossings')
      : null,
    refresh: query.refetch,
  }
}
