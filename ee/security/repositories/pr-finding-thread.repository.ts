/**
 * LUM-1127 — `PrFindingThread`: one row per (PR, fingerprint) Lumo commented
 * on inline, carrying the GitHub thread's identity and lifecycle state across
 * head commits. Queries only — the lifecycle rules live in
 * `pr-finding-thread.service.ts`.
 */
import { prisma } from '@/lib/db/prisma'
import type {
  FindingKind,
  FindingProvenance,
} from '@/ee/security/repositories/pr-security-scan.repository'

export type FindingThreadState =
  | 'OPEN'
  | 'ADDRESSED'
  | 'RESOLVED_BY_USER'
  | 'DISMISSED'

export interface FindingThreadRow {
  id: string
  pullRequestId: string
  fingerprint: string
  commentId: string
  threadNodeId: string | null
  state: FindingThreadState
  ruleId: string
  provenance: FindingProvenance
  kind: FindingKind
  filePath: string
  resolvedByLogin: string | null
  addressedInSha: string | null
}

/** What a new (or re-pointed) thread row records about its finding. */
export interface FindingThreadUpsert {
  pullRequestId: string
  workspaceId: string
  fingerprint: string
  commentId: string
  threadNodeId?: string | null
  state?: FindingThreadState
  resolvedByLogin?: string | null
  ruleId: string
  provenance: FindingProvenance
  kind: FindingKind
  filePath: string
}

export interface FindingThreadPatch {
  state?: FindingThreadState
  threadNodeId?: string | null
  commentId?: string
  resolvedByLogin?: string | null
  resolvedAt?: Date | null
  addressedInSha?: string | null
}

/** A finding's layer facts, looked up for a marker comment with no row yet. */
export interface FindingLayerMeta {
  fingerprint: string
  ruleId: string
  provenance: FindingProvenance
  kind: FindingKind
  filePath: string
}

/**
 * LUM-1127 follow-up — what the rule-id-tolerant same-issue match reads of a
 * finding (the newest row of its fingerprint on the PR).
 */
export interface FindingIdentityRow {
  fingerprint: string
  ruleId: string
  provenance: FindingProvenance
  filePath: string
  line: number | null
  title: string
  evidence: string
}

const THREAD_SELECT = {
  id: true,
  pullRequestId: true,
  fingerprint: true,
  commentId: true,
  threadNodeId: true,
  state: true,
  ruleId: true,
  provenance: true,
  kind: true,
  filePath: true,
  resolvedByLogin: true,
  addressedInSha: true,
} as const

export const prFindingThreadRepository = {
  async findByPullRequest(pullRequestId: string): Promise<FindingThreadRow[]> {
    return prisma.prFindingThread.findMany({
      where: { pullRequestId },
      select: THREAD_SELECT,
      orderBy: { createdAt: 'asc' },
    })
  },

  /** The rows a `pull_request_review_thread` delivery can refer to. */
  async findByThreadRef(
    pullRequestId: string,
    ref: { threadNodeId: string | null; commentIds: string[] }
  ): Promise<FindingThreadRow[]> {
    const or = [
      ...(ref.threadNodeId ? [{ threadNodeId: ref.threadNodeId }] : []),
      ...(ref.commentIds.length > 0
        ? [{ commentId: { in: ref.commentIds } }]
        : []),
    ]
    if (or.length === 0) return []
    return prisma.prFindingThread.findMany({
      where: { pullRequestId, OR: or },
      select: THREAD_SELECT,
    })
  },

  /** Create the row, or point an existing one at a new comment. */
  async upsert(input: FindingThreadUpsert): Promise<void> {
    const { pullRequestId, fingerprint, ...rest } = input
    await prisma.prFindingThread.upsert({
      where: { pullRequestId_fingerprint: { pullRequestId, fingerprint } },
      create: { pullRequestId, fingerprint, ...rest },
      update: {
        commentId: rest.commentId,
        threadNodeId: rest.threadNodeId ?? null,
        state: rest.state ?? 'OPEN',
        resolvedByLogin: rest.resolvedByLogin ?? null,
        resolvedAt: null,
        // A re-pointed thread starts over: no stale "addressed on" head.
        addressedInSha: null,
        filePath: rest.filePath,
      },
    })
  },

  async update(id: string, patch: FindingThreadPatch): Promise<void> {
    await prisma.prFindingThread.update({ where: { id }, data: patch })
  },

  /**
   * LUM-1131: claim a human reply for answering — false when this exact reply
   * was already claimed (a redelivered webhook), so it is answered once.
   */
  async claimReply(id: string, replyId: string): Promise<boolean> {
    const res = await prisma.prFindingThread.updateMany({
      where: {
        id,
        OR: [{ lastReplyId: null }, { lastReplyId: { not: replyId } }],
      },
      data: { lastReplyId: replyId },
    })
    return res.count > 0
  },

  /**
   * LUM-1131: undo `claimReply` after the answer failed, so a redelivery of
   * the same reply is answered. Only while this reply still holds the claim.
   */
  async releaseReply(id: string, replyId: string): Promise<void> {
    await prisma.prFindingThread.updateMany({
      where: { id, lastReplyId: replyId },
      data: { lastReplyId: null },
    })
  },

  /**
   * Fingerprints a human resolved on GitHub, per PR — the read models drop
   * the non-blocking ones from "open" (the gate never reads this).
   */
  async findResolvedByUserFingerprints(
    pullRequestIds: string[]
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>()
    if (pullRequestIds.length === 0) return out
    const rows = await prisma.prFindingThread.findMany({
      where: {
        pullRequestId: { in: pullRequestIds },
        state: 'RESOLVED_BY_USER',
      },
      select: { pullRequestId: true, fingerprint: true },
    })
    for (const r of rows) {
      const set = out.get(r.pullRequestId) ?? new Set<string>()
      set.add(r.fingerprint)
      out.set(r.pullRequestId, set)
    }
    return out
  },

  /**
   * The newest finding row of each fingerprint on any scan of the PR — the
   * layer facts a marker comment posted before this table existed needs to
   * get a row of its own (lazy adoption).
   */
  async findLayerMetaByFingerprints(
    pullRequestId: string,
    fingerprints: string[]
  ): Promise<FindingLayerMeta[]> {
    if (fingerprints.length === 0) return []
    const rows = await prisma.prSecurityFinding.findMany({
      where: {
        fingerprint: { in: fingerprints },
        scan: { pullRequestId },
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['fingerprint'],
      select: {
        fingerprint: true,
        ruleId: true,
        provenance: true,
        kind: true,
        filePath: true,
      },
    })
    return rows
  },

  /**
   * LUM-1127 follow-up — the newest finding row of each fingerprint on any
   * scan of the PR, with what the same-issue match compares (line, title,
   * quoted evidence): a thread's finding the latest review no longer reports
   * by fingerprint is checked against the findings it does report.
   */
  async findIdentitiesByFingerprints(
    pullRequestId: string,
    fingerprints: string[]
  ): Promise<FindingIdentityRow[]> {
    if (fingerprints.length === 0) return []
    return prisma.prSecurityFinding.findMany({
      where: {
        fingerprint: { in: fingerprints },
        scan: { pullRequestId },
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['fingerprint'],
      select: {
        fingerprint: true,
        ruleId: true,
        provenance: true,
        filePath: true,
        line: true,
        title: true,
        evidence: true,
      },
    })
  },
}
