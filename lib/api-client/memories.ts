import { apiFetch } from './base'
import type {
  MemoryScope,
  MemoryCategory,
  TaskArtifactAgent,
} from '@prisma/client'

export type CreateOutcome = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP'

export interface MemoryRow {
  id: string
  scope: MemoryScope
  category: MemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  taskId: string | null
  createdByMemberId: string | null
  createdAt: string
  updatedAt: string
  /** LUM-783: write-time injection scan of the content; null = clean. */
  contentSignals?: unknown
}

interface CreateBody {
  category: MemoryCategory
  content: unknown
}

/** Why a memory is proposed for retirement (LUM-540 P4a; 'stale-anchor' added in
 *  LUM-547 P4b). Mirrors the wire shape of the service's RetireReason without
 *  importing server code. */
export type RetireReason = 'low-judged-used' | 'contradiction' | 'stale-anchor'

/** A dead code anchor the memory references (file path / symbol / flag) — shown
 *  to the human reviewer as evidence when the reason is 'stale-anchor'. */
export interface StaleAnchorEvidence {
  kind: string
  value: string
}

export interface RetireCandidate {
  memoryId: string
  reasons: RetireReason[]
  /** Present only when `reasons` includes 'stale-anchor' (LUM-547). */
  staleAnchors?: StaleAnchorEvidence[]
}

/** A near-dup merge proposal from the LUM-541 batch consolidation sweep: the
 *  row kept ACTIVE plus the near-dup siblings merged away on confirm. Mirrors
 *  the service's MergeProposal wire shape without importing server code. */
export interface MergeProposal {
  canonicalId: string
  supersededIds: string[]
}

/** A topic-fold proposal from the LUM-553 autonomous fold pass: a coarse
 *  summary card that would replace a set of source memories. Mirrors the
 *  service's FoldProposal wire shape without importing server code. */
export interface FoldProposal {
  category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'
  coarseContent: unknown
  sourceIds: string[]
  excludedIds: string[]
}

export const memoriesClient = {
  listForProject(projectId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/projects/${projectId}/memories`)
  },

  listForTask(taskId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/tasks/${taskId}/memories`)
  },

  createForProject(
    projectId: string,
    body: CreateBody
  ): Promise<{ memory: { id: string }; outcome: CreateOutcome }> {
    return apiFetch(`/api/projects/${projectId}/memories`, {
      method: 'POST',
      body,
    })
  },

  createForTask(
    taskId: string,
    body: CreateBody
  ): Promise<{ memory: { id: string }; outcome: CreateOutcome }> {
    return apiFetch(`/api/tasks/${taskId}/memories`, { method: 'POST', body })
  },

  editContent(
    memoryId: string,
    content: unknown
  ): Promise<{ memory: MemoryRow }> {
    return apiFetch(`/api/memories/${memoryId}`, {
      method: 'PATCH',
      body: { content },
    })
  },

  promoteToProject(
    memoryId: string,
    content?: unknown
  ): Promise<{ memory: MemoryRow }> {
    return apiFetch(`/api/memories/${memoryId}`, {
      method: 'PATCH',
      body:
        content !== undefined
          ? { scope: 'PROJECT', content }
          : { scope: 'PROJECT' },
    })
  },

  remove(memoryId: string): Promise<void> {
    return apiFetch(`/api/memories/${memoryId}`, { method: 'DELETE' })
  },

  /** Derived list of a project's ACTIVE memories proposed for retirement
   *  (LUM-540 P4a) — low judged-used track record and/or curation-judge
   *  clearly-wrong. Read-only; nothing is persisted. */
  retireCandidates(
    projectId: string
  ): Promise<{ candidates: RetireCandidate[] }> {
    return apiFetch(`/api/projects/${projectId}/memories/retire-candidates`)
  },

  /** Human-confirmed retirement: flips the memory through the existing status
   *  machine (ACTIVE→ARCHIVED, reversible) — never a hard delete. Human-only on
   *  the server (a bearer/CLI caller is refused 403). */
  confirmRetire(memoryId: string): Promise<{ retired: number }> {
    return apiFetch(`/api/memories/${memoryId}/retire`, { method: 'POST' })
  },

  /** Derived near-dup merge proposals for a project's ACTIVE PROJECT memories
   *  (LUM-541 P5) — each cluster's canonical-keep + supersede-set, plus the live
   *  cluster count. Read-only; nothing is persisted. */
  mergeCandidates(
    projectId: string
  ): Promise<{ candidates: MergeProposal[]; clusterCount: number }> {
    return apiFetch(`/api/projects/${projectId}/memories/merge-candidates`)
  },

  /** Human-confirmed near-dup merge: archives the superseded duplicates through
   *  the existing status machine (ACTIVE→ARCHIVED, reversible) — never a hard
   *  delete. Human-only on the server (a bearer/CLI caller is refused 403). */
  confirmMerge(
    projectId: string,
    body: { canonicalId: string; supersededIds: string[] }
  ): Promise<{ merged: number }> {
    return apiFetch(`/api/projects/${projectId}/memories/merge`, {
      method: 'POST',
      body,
    })
  },

  /** Read-only dry-run preview of the autonomous topic-fold pass (LUM-553):
   *  the coarse-card proposals + the source ids each would fold / leave behind.
   *  Bearer-allowed — an agent/CLI is meant to run this (`lumo memory fold
   *  --dry-run`). Writes nothing; folding only runs server-side in the daily
   *  cron. */
  foldCandidates(projectId: string): Promise<{ proposals: FoldProposal[] }> {
    return apiFetch(`/api/projects/${projectId}/memories/fold-candidates`)
  },
}
