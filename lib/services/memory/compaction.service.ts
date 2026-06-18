import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  lineageEdgeRepository,
  type FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageService } from '@/lib/services/lineage.service'
import { logger } from '@/lib/logger'

/**
 * LUM-328 — usage-strength cold eviction (MemoryBank forgetting curve).
 *
 * When a project's ACTIVE PROJECT-scope memory count exceeds the threshold,
 * the hourly sweep archives the coldest rows (status → ARCHIVED, zero schema
 * change) so the session-start injection budget is spent on memories that
 * earn their keep. Every read path already filters status='ACTIVE' (LUM-325),
 * so archiving removes a row from injection and reconcile-neighbor retrieval
 * while keeping it visible to lineage/audit; flipping the status back fully
 * restores it.
 *
 * Ranking (coldest first): primary key is the LUM-539 judged-used rate
 * (judged-used tasks / audited tasks, task-deduped), tie-broken by the
 * MemoryBank retention term R = e^(-t/S) with strength S = 1 + usedTasks and
 * t = days since the last used=true vote (creation when never used). The
 * corpus is currently too young for t to discriminate (prod: 0 rows >30d) —
 * the term is kept so ranking sharpens as the corpus ages.
 *
 * Protections (never archived): manual curation (createdByMemberId set),
 * rows inside the freshness window (new memories need time to accrue usage
 * votes), `qualified` judged-used trust verdicts (mirror of the LUM-325
 * supersede-guard), and rows used within the recent-use window.
 */

/** A project participates in compaction only above this many ACTIVE PROJECT rows. */
export const COMPACTION_ACTIVE_THRESHOLD = 100
/** Per-sweep eviction cap — keeps the injection set from mutating abruptly. */
export const COMPACTION_SWEEP_CAP = 10
/** Rows younger than this never evict — the window to accrue usage votes. */
export const COMPACTION_FRESHNESS_DAYS = 14
/** Rows voted used within this window never evict. */
export const COMPACTION_RECENT_USE_DAYS = 14

const DAY_MS = 86_400_000

export interface CompactionOptions {
  now?: Date
  threshold?: number
  cap?: number
  freshnessDays?: number
  recentUseDays?: number
}

export interface ProjectCompactionResult {
  projectId: string
  activeBefore: number
  archived: number
  protected: number
}

export interface CompactionSweepResult {
  projectsOverThreshold: number
  archivedTotal: number
  projects: ProjectCompactionResult[]
}

interface CompactionRow {
  id: string
  createdAt: Date
  createdByMemberId: string | null
}

export const memoryCompactionService = {
  /**
   * One compaction pass over every project above the ACTIVE threshold.
   * Best-effort end to end: a failing project is logged and skipped, and an
   * enumeration failure degrades to an empty result — compaction must never
   * take down the cron's outcome/usage sweeps.
   */
  async sweepColdProjectMemories(
    options: CompactionOptions = {}
  ): Promise<CompactionSweepResult> {
    const now = options.now ?? new Date()
    const threshold = options.threshold ?? COMPACTION_ACTIVE_THRESHOLD
    const cap = options.cap ?? COMPACTION_SWEEP_CAP
    const freshnessDays = options.freshnessDays ?? COMPACTION_FRESHNESS_DAYS
    const recentUseDays = options.recentUseDays ?? COMPACTION_RECENT_USE_DAYS

    const result: CompactionSweepResult = {
      projectsOverThreshold: 0,
      archivedTotal: 0,
      projects: [],
    }

    let overThreshold: { projectId: string; activeCount: number }[]
    try {
      overThreshold =
        await memoryRepository.findProjectsOverActiveMemoryThreshold(threshold)
    } catch (err) {
      logger.error('memory compaction: threshold enumeration failed', err)
      return result
    }
    result.projectsOverThreshold = overThreshold.length

    for (const { projectId } of overThreshold) {
      try {
        const project = await compactProject(projectId, {
          now,
          threshold,
          cap,
          freshnessDays,
          recentUseDays,
        })
        result.projects.push(project)
        result.archivedTotal += project.archived
      } catch (err) {
        logger.error(
          `memory compaction: project ${projectId} failed; continuing`,
          err
        )
      }
    }

    return result
  },
}

async function compactProject(
  projectId: string,
  opts: Required<Omit<CompactionOptions, 'now'>> & { now: Date }
): Promise<ProjectCompactionResult> {
  const { now, threshold, cap, freshnessDays, recentUseDays } = opts

  const rows: CompactionRow[] =
    await memoryRepository.findActiveProjectMemoriesForCompaction(projectId)
  const overage = rows.length - threshold
  if (overage <= 0) {
    return { projectId, activeBefore: rows.length, archived: 0, protected: 0 }
  }

  const freshnessCutoff = new Date(now.getTime() - freshnessDays * DAY_MS)
  const recentUseCutoff = new Date(now.getTime() - recentUseDays * DAY_MS)

  // Resolve every row to its canonical fragment — lineage edges are keyed by
  // the canonical id after consolidation re-keys (LUM-280).
  const canonicalById = new Map<string, string>()
  for (const row of rows) {
    canonicalById.set(
      row.id,
      await memoryProvenanceRepository.resolveCanonicalFragment(
        'MEMORY',
        row.id
      )
    )
  }
  const refs: FragmentRef[] = rows.map(row => ({
    fragmentType: 'MEMORY',
    fragmentId: canonicalById.get(row.id) as string,
  }))

  const [trust, judged, lastUsed] = await Promise.all([
    lineageService.fragmentTrustForMemories(rows.map(r => r.id)),
    lineageEdgeRepository.judgedUsageByFragments(refs),
    lineageEdgeRepository.lastUsedAtByFragments(refs),
  ])
  // LUM-539: cold-eviction ranks on the judged-used track record, not merge rate.
  // usageRate = judged-used tasks / audited tasks — never-audited appearances are
  // excluded from the denominator (abstention is not negative evidence).
  const auditedTasksByFragment = new Map(
    judged.map(j => [j.fragmentId, j.auditedTasks])
  )
  const usedTasksByFragment = new Map(
    judged.map(j => [j.fragmentId, j.judgedUsedTasks])
  )
  const lastUsedByFragment = new Map(
    lastUsed.map(l => [l.fragmentId, l.lastUsedAt])
  )

  let protectedCount = 0
  const candidates: {
    id: string
    usageRate: number
    retention: number
    createdAt: Date
  }[] = []
  for (const row of rows) {
    const canonical = canonicalById.get(row.id) as string
    const lastUsedAt = lastUsedByFragment.get(canonical) ?? null
    const isProtected =
      row.createdByMemberId !== null ||
      row.createdAt > freshnessCutoff ||
      trust[row.id]?.qualified === true ||
      (lastUsedAt !== null && lastUsedAt > recentUseCutoff)
    if (isProtected) {
      protectedCount++
      continue
    }

    const auditedTasks = auditedTasksByFragment.get(canonical) ?? 0
    const usedTasks = usedTasksByFragment.get(canonical) ?? 0
    const usageRate = auditedTasks > 0 ? usedTasks / auditedTasks : 0
    // MemoryBank: R = e^(-t/S), S grows with each recall (used vote).
    const strength = 1 + usedTasks
    const tDays =
      (now.getTime() - (lastUsedAt ?? row.createdAt).getTime()) / DAY_MS
    const retention = Math.exp(-Math.max(0, tDays) / strength)
    candidates.push({
      id: row.id,
      usageRate,
      retention,
      createdAt: row.createdAt,
    })
  }

  candidates.sort(
    (a, b) =>
      a.usageRate - b.usageRate ||
      a.retention - b.retention ||
      a.createdAt.getTime() - b.createdAt.getTime()
  )

  const evictIds = candidates.slice(0, Math.min(cap, overage)).map(c => c.id)
  let archived = 0
  if (evictIds.length > 0) {
    const res = await memoryRepository.archiveMemories(evictIds)
    archived = res.count
  }

  return {
    projectId,
    activeBefore: rows.length,
    archived,
    protected: protectedCount,
  }
}
