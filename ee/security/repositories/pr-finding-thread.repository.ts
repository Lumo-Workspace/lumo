/**
 * LUM-1127 — `PrFindingThread`: one row per (PR, fingerprint) Lumo commented
 * on inline, carrying the GitHub thread's identity and lifecycle state across
 * head commits. Queries only — the lifecycle rules live in
 * `pr-finding-thread.service.ts`.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { IdentityVariant } from '@/ee/security/security-scan/finding-successor'
import { threadFingerprints } from '@/ee/security/security-scan/thread-fingerprints'
import type {
  FindingKind,
  FindingProvenance,
  FindingSeverity,
} from '@/ee/security/repositories/pr-security-scan.repository'

export type FindingThreadState =
  | 'OPEN'
  | 'ADDRESSED'
  | 'RESOLVED_BY_USER'
  | 'DISMISSED'

/**
 * LUM-1127 follow-up #2 — the identity of the finding a thread stands for,
 * kept on the row: a full re-review of the same head replaces the scan's
 * finding rows, so the thread's original finding may no longer exist. Hashes
 * only (`evidenceHash` / `titleTokens` of `finding-successor`) — no code.
 * `identityRuleId` null = not recorded yet. Optional on the row type so
 * hand-built rows (adoption, tests) need not spell it out.
 */
export interface StoredThreadIdentity {
  identityRuleId?: string | null
  identityLine?: number | null
  identitySeverity?: FindingSeverity | null
  identityEvidenceHash?: string | null
  identityTitleTokens?: string[]
  /**
   * LUM-1127 follow-up #4 — every identity the thread has carried (hashes
   * only, oldest first, capped): the union, never overwritten.
   */
  identityHistory?: IdentityVariant[]
}

export interface FindingThreadRow extends StoredThreadIdentity {
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
  /**
   * LUM-1127 follow-up #3 — the fingerprints the thread was carried to (the
   * same issue relabelled), oldest first; `fingerprint` stays its original.
   * Optional so hand-built rows (adoption, tests) need not spell it out.
   */
  aliasFingerprints?: string[]
}

/** What a new (or re-pointed) thread row records about its finding. */
export interface FindingThreadUpsert extends StoredThreadIdentity {
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

export interface FindingThreadPatch extends StoredThreadIdentity {
  state?: FindingThreadState
  threadNodeId?: string | null
  commentId?: string
  resolvedByLogin?: string | null
  resolvedAt?: Date | null
  addressedInSha?: string | null
  aliasFingerprints?: string[]
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
  severity: FindingSeverity
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
  identityRuleId: true,
  identityLine: true,
  identitySeverity: true,
  identityEvidenceHash: true,
  identityTitleTokens: true,
  aliasFingerprints: true,
  identityHistory: true,
} as const

/**
 * The stored history as variants: entries of another shape (a hand edit, a
 * future format) are skipped, never trusted.
 */
export function parseIdentityHistory(raw: unknown): IdentityVariant[] {
  if (!Array.isArray(raw)) return []
  const out: IdentityVariant[] = []
  for (const e of raw as unknown[]) {
    if (typeof e !== 'object' || e === null) continue
    const v = e as Record<string, unknown>
    if (typeof v.ruleId !== 'string') continue
    if (v.line !== null && typeof v.line !== 'number') continue
    if (v.evidenceHash !== null && typeof v.evidenceHash !== 'string') continue
    if (
      !Array.isArray(v.titleTokens) ||
      !v.titleTokens.every(t => typeof t === 'string')
    )
      continue
    out.push({
      ruleId: v.ruleId,
      line: v.line,
      evidenceHash: v.evidenceHash,
      titleTokens: v.titleTokens as string[],
      ...(v.crowded === true ? { crowded: true } : {}),
    })
  }
  return out
}

type SelectedThread = Omit<FindingThreadRow, 'identityHistory'> & {
  identityHistory: Prisma.JsonValue
}

function toRow(r: SelectedThread): FindingThreadRow {
  return { ...r, identityHistory: parseIdentityHistory(r.identityHistory) }
}

/** The history as Prisma writes it (a JSON array). */
function historyInput(
  h: readonly IdentityVariant[] | undefined
): Prisma.InputJsonValue | undefined {
  return h === undefined ? undefined : (h as unknown as Prisma.InputJsonValue)
}

export const prFindingThreadRepository = {
  async findByPullRequest(pullRequestId: string): Promise<FindingThreadRow[]> {
    const rows = await prisma.prFindingThread.findMany({
      where: { pullRequestId },
      select: THREAD_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toRow)
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
    const rows = await prisma.prFindingThread.findMany({
      where: { pullRequestId, OR: or },
      select: THREAD_SELECT,
    })
    return rows.map(toRow)
  },

  /** Create the row, or point an existing one at a new comment. */
  async upsert(input: FindingThreadUpsert): Promise<void> {
    const { pullRequestId, fingerprint, identityHistory, ...rest } = input
    const history = historyInput(identityHistory)
    await prisma.prFindingThread.upsert({
      where: { pullRequestId_fingerprint: { pullRequestId, fingerprint } },
      create: {
        pullRequestId,
        fingerprint,
        ...rest,
        ...(history !== undefined ? { identityHistory: history } : {}),
      },
      update: {
        commentId: rest.commentId,
        threadNodeId: rest.threadNodeId ?? null,
        state: rest.state ?? 'OPEN',
        resolvedByLogin: rest.resolvedByLogin ?? null,
        resolvedAt: null,
        // A re-pointed thread starts over: no stale "addressed on" head.
        addressedInSha: null,
        filePath: rest.filePath,
        // A re-pointed thread stands for the finding it was re-posted for.
        ...(rest.identityRuleId !== undefined
          ? {
              identityRuleId: rest.identityRuleId,
              identityLine: rest.identityLine ?? null,
              identitySeverity: rest.identitySeverity ?? null,
              identityEvidenceHash: rest.identityEvidenceHash ?? null,
              identityTitleTokens: rest.identityTitleTokens ?? [],
              identityHistory: history ?? [],
            }
          : {}),
      },
    })
  },

  async update(id: string, patch: FindingThreadPatch): Promise<void> {
    const { identityHistory, ...rest } = patch
    const history = historyInput(identityHistory)
    await prisma.prFindingThread.update({
      where: { id },
      data: {
        ...rest,
        ...(history !== undefined ? { identityHistory: history } : {}),
      },
    })
  },

  /**
   * LUM-1127 follow-up #3 — drop a duplicate thread's row once it is merged
   * into the thread that keeps the issue (its fingerprints become that row's
   * aliases first, so its marker comment is never adopted again).
   */
  async delete(id: string): Promise<void> {
    await prisma.prFindingThread.deleteMany({ where: { id } })
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
      select: {
        pullRequestId: true,
        fingerprint: true,
        aliasFingerprints: true,
      },
    })
    for (const r of rows) {
      const set = out.get(r.pullRequestId) ?? new Set<string>()
      // A carried thread stands for its aliases too (LUM-1127 follow-up #3).
      for (const fp of threadFingerprints(r)) set.add(fp)
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
        severity: true,
        evidence: true,
      },
    })
  },
}
