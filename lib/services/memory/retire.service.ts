import { isRetireCandidate } from '@/lib/services/lineage-signal'
import type { TrustVerdict } from '@/lib/services/lineage-signal'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageService } from '@/lib/services/lineage.service'

/**
 * LUM-540 (P4a) — the retire action loop. Memory "entropy management" needs a
 * retire half (without it the store grows monotonically). Two INDEPENDENT
 * signals propose a memory for retirement:
 *
 *  - `low-judged-used` — the LUM-539 judged-used track record says the fragment
 *    cleared the cold-start grace yet was never once judged used
 *    (`isRetireCandidate`). Reuses the existing signal; never reads merge rate.
 *  - `contradiction` — the curation-judge flagged it clearly-wrong (the same
 *    judge LUM-544 uses at DONE-time), surfaced here as a retire candidate.
 *  - `stale-anchor` (LUM-547, P4b) — `lumo memory sync` found that every code
 *    anchor the memory names (file path / symbol / flag) is gone from the repo.
 *    Unlike the other two, this signal is computed CLIENT-side (the server has
 *    no repo) and PERSISTED (`MemoryStaleAnchorReport`), so it is read back here
 *    with its dead-anchor evidence rather than recomputed.
 *
 * Candidacy is DERIVED for the usage/contradiction signals (no status column);
 * the stale-anchor signal needs a tiny persisted report because detection is
 * async + off-box. Selection is still pure (zero writes). Retirement happens only
 * on explicit human/web confirmation, and routes through the EXISTING status
 * machine (`archiveMemories`: ACTIVE→ARCHIVED, guarded + reversible) — 失效非删,
 * never a hard delete. All signals funnel through the one `retireConfirmed` action.
 */

export type RetireReason = 'low-judged-used' | 'contradiction' | 'stale-anchor'

/** A dead code anchor (file path / symbol / flag) — evidence for the reviewer. */
export interface StaleAnchorEvidence {
  kind: string
  value: string
}

export interface RetireCandidate {
  memoryId: string
  reasons: RetireReason[]
  /** Present only when `reasons` includes `stale-anchor` — the dead anchors. */
  staleAnchors?: StaleAnchorEvidence[]
}

export interface SelectRetireInput {
  /** The ACTIVE memories under consideration (e.g. a project's PROJECT memories). */
  memories: { id: string }[]
  /**
   * Per-memory judged-used verdict. Only fragments that cleared the cold-start
   * grace appear here (`computeFragmentTrust` omits the rest) — so a never-audited
   * memory is structurally absent, and abstention can never be read as negative
   * evidence (the mis-kill guard).
   */
  trustByMemoryId: Map<string, TrustVerdict>
  /** Memory ids the curation-judge confidently flagged clearly-wrong. */
  contradictionMemoryIds: Set<string>
  /**
   * Per-memory dead-anchor evidence from a persisted stale-anchor report
   * (LUM-547). A memory is proposed via this signal only when its evidence list
   * is non-empty. Optional — absent for callers that don't carry the signal.
   */
  staleAnchorsByMemoryId?: Map<string, StaleAnchorEvidence[]>
}

/**
 * Pure selection of retire candidates — performs NO writes. A memory is proposed
 * via the usage signal only when it has a qualified verdict that `isRetireCandidate`
 * (audited ≥ floor, never judged used); cold-start / never-audited memories are
 * never proposed via usage. The contradiction signal is independent and can apply
 * to any memory. A memory flagged by both carries both reasons.
 */
export function selectRetireCandidates(
  input: SelectRetireInput
): RetireCandidate[] {
  const candidates: RetireCandidate[] = []
  for (const m of input.memories) {
    const reasons: RetireReason[] = []
    const v = input.trustByMemoryId.get(m.id)
    if (v && isRetireCandidate(v)) reasons.push('low-judged-used')
    if (input.contradictionMemoryIds.has(m.id)) reasons.push('contradiction')
    const stale = input.staleAnchorsByMemoryId?.get(m.id)
    if (stale && stale.length > 0) reasons.push('stale-anchor')
    if (reasons.length > 0) {
      const candidate: RetireCandidate = { memoryId: m.id, reasons }
      if (stale && stale.length > 0) candidate.staleAnchors = stale
      candidates.push(candidate)
    }
  }
  return candidates
}

/**
 * The single, shared retire action — invoked only on explicit human/web
 * confirmation. Flips the memory through the existing status machine
 * (ACTIVE→ARCHIVED, guarded on ACTIVE so an unconfirmed/already-retired row is a
 * no-op) and NEVER hard-deletes. Returns the number of rows actually retired
 * (0 or 1).
 */
export async function retireConfirmed(memoryId: string): Promise<number> {
  const res = await memoryRepository.archiveMemories([memoryId])
  return res.count
}

export interface ComputeRetireOptions {
  /**
   * Memory ids the curation-judge flagged clearly-wrong. The standing sweep has
   * no per-session event log to (re)run the judge against, so the contradiction
   * set is injected by the caller (e.g. the LUM-544 DONE-time curation routing
   * its clearly-wrong verdict here instead of auto-invalidating). Defaults to
   * empty — the usage signal alone still proposes candidates.
   */
  contradictionMemoryIds?: Set<string>
}

/**
 * Orchestrated entry point: assemble the retire candidates for a project's
 * ACTIVE PROJECT memories. Reads the live judged-used track record
 * ({@link lineageService.fragmentTrustForMemories} — cold-start ids omitted) and
 * folds in the injected contradiction set, then defers to the pure
 * {@link selectRetireCandidates}. Read-only.
 */
export async function computeProjectRetireCandidates(
  projectId: string,
  opts: ComputeRetireOptions = {}
): Promise<RetireCandidate[]> {
  const memories = await memoryRepository.listForProject(projectId)
  if (memories.length === 0) return []
  const [trustRecord, staleReports] = await Promise.all([
    lineageService.fragmentTrustForMemories(memories.map(m => m.id)),
    memoryRepository.listStaleAnchorReportsForProject(projectId),
  ])
  const staleAnchorsByMemoryId = new Map<string, StaleAnchorEvidence[]>(
    staleReports.map(r => [r.memoryId, normalizeAnchors(r.deadAnchors)])
  )
  return selectRetireCandidates({
    memories,
    trustByMemoryId: new Map(Object.entries(trustRecord)),
    contradictionMemoryIds: opts.contradictionMemoryIds ?? new Set(),
    staleAnchorsByMemoryId,
  })
}

/** Coerce a persisted `deadAnchors` JSON value into typed evidence, dropping
 * any malformed entries (the column is Json — never trust its shape blindly). */
function normalizeAnchors(raw: unknown): StaleAnchorEvidence[] {
  if (!Array.isArray(raw)) return []
  const out: StaleAnchorEvidence[] = []
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { kind?: unknown }).kind === 'string' &&
      typeof (item as { value?: unknown }).value === 'string'
    ) {
      out.push({
        kind: (item as { kind: string }).kind,
        value: (item as { value: string }).value,
      })
    }
  }
  return out
}
