/**
 * LUM-395: flywheel rehabilitation-channel audit (read-only, measure-first).
 *
 * Quantifies whether the LUM-279 ranking demotion → LUM-314 usage-vote
 * starvation → LUM-328 cold eviction chain produces a self-reinforcing
 * death spiral for memories that were contradicted/demoted but may be
 * correct. Three required metrics over ACTIVE PROJECT-scope memories:
 *
 *   (a) never-injected (zero lineage edges) or injected-but-never-voted
 *       (all edges used IS NULL)
 *   (b) next-sweep eviction candidates: past the freshness window, covered
 *       by none of the four LUM-328 protections (manual / freshness /
 *       usage-trust / recent-use) — reported both threshold-gated (what the
 *       next sweep actually archives) and ungated (the at-risk pool)
 *   (c) the (b) subset linked to a SUPERSEDE chain or MemoryProvenance row
 *       (the contradicted high-risk group)
 *
 * Plus the ARCHIVED retrospective: for every ARCHIVED PROJECT memory, the
 * most-similar ACTIVE memory created after the archive (pgvector cosine) —
 * a high-sim later rewrite is wrongful-kill evidence.
 *
 * Run:   DOTENV_CONFIG_PATH=.env.production npx tsx scripts/analysis/lum395-flywheel-rehab/audit.ts
 * Loads .env.production by default (pre-set DATABASE_URL wins — dotenv never
 * overrides). Only SELECTs are issued; no row is ever written.
 *
 * Output: stdout summary + scripts/analysis/lum395-flywheel-rehab/out/report.json
 */
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.production' })

// LUM-329 calibrated same-topic floor for qwen3-embedding-0.6b.
const SAME_TOPIC_SIM_FLOOR = 0.78

interface MemoryRow {
  id: string
  projectId: string
  category: string
  createdAt: Date
  createdByMemberId: string | null
  contentPreview: string
}

interface AuditedMemory extends MemoryRow {
  canonicalId: string
  edgeCount: number
  distinctTasks: number
  lastIncludedAt: string | null
  usedTrue: number
  usedFalse: number
  usedNull: number
  tier: 0 | 1 | 2
  resolvedTasks: number
  mergedTasks: number
  protections: string[]
  neverInjected: boolean
  allUsedNull: boolean
  atRisk: boolean
  nextSweepEvict: boolean
  supersedeWinner: boolean
  provenanceLinked: boolean
}

function previewOf(content: unknown): string {
  const text = JSON.stringify(content) ?? ''
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  const { memoryProvenanceRepository } =
    await import('@/lib/repositories/memory-provenance.repository')
  const { lineageEdgeRepository } =
    await import('@/lib/repositories/lineage-edge.repository')
  const { lineageService } = await import('@/lib/services/lineage.service')
  const { tierOf } = await import('@/lib/lineage/ranking')
  const {
    COMPACTION_ACTIVE_THRESHOLD,
    COMPACTION_SWEEP_CAP,
    COMPACTION_FRESHNESS_DAYS,
    COMPACTION_RECENT_USE_DAYS,
  } = await import('@/lib/services/memory/compaction.service')

  const now = new Date()
  const DAY_MS = 86_400_000
  const freshnessCutoff = new Date(
    now.getTime() - COMPACTION_FRESHNESS_DAYS * DAY_MS
  )
  const recentUseCutoff = new Date(
    now.getTime() - COMPACTION_RECENT_USE_DAYS * DAY_MS
  )

  // ── Global context ────────────────────────────────────────────────────────
  const byScopeStatus = await prisma.memory.groupBy({
    by: ['scope', 'status'],
    _count: { _all: true },
  })
  const edgeUsedDist = await prisma.lineageEdge.groupBy({
    by: ['used'],
    where: { fragmentType: 'MEMORY' },
    _count: { _all: true },
  })

  // ── Audit universe: ACTIVE PROJECT memories ───────────────────────────────
  const activeRaw = await prisma.memory.findMany({
    where: { scope: 'PROJECT', status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      projectId: true,
      category: true,
      createdAt: true,
      createdByMemberId: true,
      content: true,
    },
  })
  const universe: MemoryRow[] = activeRaw.map(m => ({
    id: m.id,
    projectId: m.projectId,
    category: m.category,
    createdAt: m.createdAt,
    createdByMemberId: m.createdByMemberId,
    contentPreview: previewOf(m.content),
  }))
  const ids = universe.map(m => m.id)

  // Canonical resolution — lineage edges are keyed by canonical id (LUM-280).
  const canonicalById = new Map<string, string>()
  for (const batch of chunk(ids, 25)) {
    await Promise.all(
      batch.map(async id => {
        canonicalById.set(
          id,
          await memoryProvenanceRepository.resolveCanonicalFragment(
            'MEMORY',
            id
          )
        )
      })
    )
  }
  const canonicalIds = [...new Set(canonicalById.values())]

  // Edge-level facts per canonical fragment.
  const edges = await prisma.lineageEdge.findMany({
    where: { fragmentType: 'MEMORY', fragmentId: { in: canonicalIds } },
    select: {
      fragmentId: true,
      taskId: true,
      includedAt: true,
      used: true,
    },
  })
  const edgesByFragment = new Map<string, typeof edges>()
  for (const e of edges) {
    const list = edgesByFragment.get(e.fragmentId) ?? []
    list.push(e)
    edgesByFragment.set(e.fragmentId, list)
  }

  // Same building blocks the sweep itself uses.
  const refs = canonicalIds.map(id => ({
    fragmentType: 'MEMORY' as const,
    fragmentId: id,
  }))
  const [trust, presence, lastUsed] = await Promise.all([
    lineageService.fragmentTrustForMemories(ids),
    lineageEdgeRepository.mergeRateByFragments(refs),
    lineageEdgeRepository.lastUsedAtByFragments(refs),
  ])
  const presenceByFragment = new Map(presence.map(p => [p.fragmentId, p]))
  const lastUsedByFragment = new Map(
    lastUsed.map(l => [l.fragmentId, l.lastUsedAt])
  )

  // Supersede / provenance involvement.
  const supersededRows = await prisma.memory.findMany({
    where: { supersededById: { in: ids } },
    select: { id: true, supersededById: true },
  })
  const supersedeWinners = new Set(
    supersededRows.map(r => r.supersededById as string)
  )
  const provenanceRows = await prisma.memoryProvenance.findMany({
    where: {
      OR: [{ childMemoryId: { in: ids } }, { parentMemoryId: { in: ids } }],
    },
    select: { childMemoryId: true, parentMemoryId: true },
  })
  const provenanceLinkedIds = new Set<string>()
  for (const r of provenanceRows) {
    provenanceLinkedIds.add(r.childMemoryId)
    provenanceLinkedIds.add(r.parentMemoryId)
  }

  // ── Per-memory classification (mirrors compactProject exactly) ────────────
  const audited: AuditedMemory[] = universe.map(row => {
    const canonicalId = canonicalById.get(row.id) as string
    const frag = edgesByFragment.get(canonicalId) ?? []
    const usedTrue = frag.filter(e => e.used === true).length
    const usedFalse = frag.filter(e => e.used === false).length
    const usedNull = frag.filter(e => e.used === null).length
    const lastIncluded = frag.reduce<Date | null>(
      (max, e) => (max === null || e.includedAt > max ? e.includedAt : max),
      null
    )
    const stat = presenceByFragment.get(canonicalId)
    const lastUsedAt = lastUsedByFragment.get(canonicalId) ?? null

    const protections: string[] = []
    if (row.createdByMemberId !== null) protections.push('manual')
    if (row.createdAt > freshnessCutoff) protections.push('freshness')
    if (trust[row.id]?.kind === 'usage') protections.push('usage-trust')
    if (lastUsedAt !== null && lastUsedAt > recentUseCutoff)
      protections.push('recent-use')

    return {
      ...row,
      canonicalId,
      edgeCount: frag.length,
      distinctTasks: new Set(frag.map(e => e.taskId)).size,
      lastIncludedAt: lastIncluded?.toISOString() ?? null,
      usedTrue,
      usedFalse,
      usedNull,
      tier: tierOf(
        stat
          ? {
              resolvedTasks: stat.resolvedTasks,
              mergedTasks: stat.mergedTasks,
            }
          : undefined
      ),
      resolvedTasks: stat?.resolvedTasks ?? 0,
      mergedTasks: stat?.mergedTasks ?? 0,
      protections,
      neverInjected: frag.length === 0,
      allUsedNull: frag.length > 0 && usedTrue === 0 && usedFalse === 0,
      atRisk: protections.length === 0,
      nextSweepEvict: false, // filled below (threshold-gated)
      supersedeWinner: supersedeWinners.has(row.id),
      provenanceLinked: provenanceLinkedIds.has(row.id),
    }
  })

  // Threshold gating + coldest-first ranking, exactly as compactProject sorts.
  const byProject = new Map<string, AuditedMemory[]>()
  for (const m of audited) {
    const list = byProject.get(m.projectId) ?? []
    list.push(m)
    byProject.set(m.projectId, list)
  }
  const usageStats = await lineageEdgeRepository.usageMergeRateByFragments(refs)
  const usedTasksByFragment = new Map(
    usageStats.map(u => [u.fragmentId, u.usedResolvedTasks])
  )
  for (const [, rows] of byProject) {
    const overage = rows.length - COMPACTION_ACTIVE_THRESHOLD
    if (overage <= 0) continue
    const candidates = rows
      .filter(m => m.atRisk)
      .map(m => {
        const resolvedTasks =
          presenceByFragment.get(m.canonicalId)?.resolvedTasks ?? 0
        const usedTasks = usedTasksByFragment.get(m.canonicalId) ?? 0
        const usageRate = resolvedTasks > 0 ? usedTasks / resolvedTasks : 0
        const lastUsedAt = lastUsedByFragment.get(m.canonicalId) ?? null
        const strength = 1 + usedTasks
        const tDays =
          (now.getTime() - (lastUsedAt ?? m.createdAt).getTime()) / DAY_MS
        const retention = Math.exp(-Math.max(0, tDays) / strength)
        return { m, usageRate, retention }
      })
      .sort(
        (a, b) =>
          a.usageRate - b.usageRate ||
          a.retention - b.retention ||
          a.m.createdAt.getTime() - b.m.createdAt.getTime()
      )
    for (const c of candidates.slice(
      0,
      Math.min(COMPACTION_SWEEP_CAP, overage)
    )) {
      c.m.nextSweepEvict = true
    }
  }

  // ── ARCHIVED retrospective: later same-topic rewrites ────────────────────
  const archivedCount = await prisma.memory.count({
    where: { scope: 'PROJECT', status: 'ARCHIVED' },
  })
  const rewriteRows = await prisma.$queryRaw<
    {
      archived_id: string
      active_id: string
      sim: number
      archived_at: Date
      active_created_at: Date
    }[]
  >`
    SELECT a.id AS archived_id, b.id AS active_id,
           1 - (a.embedding <=> b.embedding) AS sim,
           a."updatedAt" AS archived_at, b."createdAt" AS active_created_at
    FROM memories a
    JOIN memories b
      ON b."projectId" = a."projectId"
     AND b.scope = 'PROJECT'
     AND b.status = 'ACTIVE'
     AND b."createdAt" > a."updatedAt"
     AND b.embedding IS NOT NULL
    WHERE a.scope = 'PROJECT'
      AND a.status = 'ARCHIVED'
      AND a.embedding IS NOT NULL
  `
  const bestRewriteByArchived = new Map<string, (typeof rewriteRows)[number]>()
  for (const r of rewriteRows) {
    const cur = bestRewriteByArchived.get(r.archived_id)
    if (!cur || r.sim > cur.sim) bestRewriteByArchived.set(r.archived_id, r)
  }
  const wrongfulKillSuspects = [...bestRewriteByArchived.values()].filter(
    r => r.sim >= SAME_TOPIC_SIM_FLOOR
  )

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const a_neverInjected = audited.filter(m => m.neverInjected)
  const a_allUsedNull = audited.filter(m => m.allUsedNull)
  const b_atRisk = audited.filter(m => m.atRisk)
  const b_nextSweep = audited.filter(m => m.nextSweepEvict)
  const c_atRiskSupersede = b_atRisk.filter(
    m => m.supersedeWinner || m.provenanceLinked
  )
  const projectsOverThreshold = [...byProject.entries()]
    .filter(([, rows]) => rows.length > COMPACTION_ACTIVE_THRESHOLD)
    .map(([projectId, rows]) => ({ projectId, activeCount: rows.length }))

  const protectionDist: Record<string, number> = {}
  for (const m of audited)
    for (const p of m.protections)
      protectionDist[p] = (protectionDist[p] ?? 0) + 1

  const report = {
    generatedAt: now.toISOString(),
    params: {
      COMPACTION_ACTIVE_THRESHOLD,
      COMPACTION_SWEEP_CAP,
      COMPACTION_FRESHNESS_DAYS,
      COMPACTION_RECENT_USE_DAYS,
      SAME_TOPIC_SIM_FLOOR,
    },
    global: {
      memoriesByScopeStatus: byScopeStatus.map(r => ({
        scope: r.scope,
        status: r.status,
        count: r._count._all,
      })),
      memoryEdgeUsedDistribution: edgeUsedDist.map(r => ({
        used: r.used,
        count: r._count._all,
      })),
    },
    universe: {
      activeProjectMemories: universe.length,
      projects: byProject.size,
      projectsOverThreshold,
      tierDistribution: {
        tier0_high: audited.filter(m => m.tier === 0).length,
        tier1_cold: audited.filter(m => m.tier === 1).length,
        tier2_provenLow: audited.filter(m => m.tier === 2).length,
      },
      protectionDistribution: protectionDist,
    },
    a_evidenceStarvation: {
      neverInjected: a_neverInjected.length,
      injectedButAllUsedNull: a_allUsedNull.length,
      combined: a_neverInjected.length + a_allUsedNull.length,
    },
    b_evictionExposure: {
      atRiskPool_ungated: b_atRisk.length,
      nextSweepEvictions_thresholdGated: b_nextSweep.length,
    },
    c_contradictedHighRisk: {
      atRiskWithSupersedeOrProvenance: c_atRiskSupersede.length,
      universeSupersedeWinners: audited.filter(m => m.supersedeWinner).length,
      universeProvenanceLinked: audited.filter(m => m.provenanceLinked).length,
    },
    archivedRetrospective: {
      archivedProjectMemories: archivedCount,
      withLaterActiveNeighbor: bestRewriteByArchived.size,
      wrongfulKillSuspects: wrongfulKillSuspects.map(r => ({
        archivedId: r.archived_id,
        rewrittenAsActiveId: r.active_id,
        cosineSim: Number(r.sim.toFixed(4)),
        archivedAt: r.archived_at,
        rewriteCreatedAt: r.active_created_at,
      })),
    },
    memories: audited.map(m => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  }

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))

  const lines = [
    `LUM-395 flywheel rehabilitation audit — ${now.toISOString()}`,
    ``,
    `Universe: ${universe.length} ACTIVE PROJECT memories across ${byProject.size} projects`,
    `  projects over compaction threshold (>${COMPACTION_ACTIVE_THRESHOLD}): ${projectsOverThreshold.length}` +
      (projectsOverThreshold.length
        ? ` (${projectsOverThreshold.map(p => `${p.projectId}:${p.activeCount}`).join(', ')})`
        : ''),
    `  ranking tiers (injection path, presence-based): high=${report.universe.tierDistribution.tier0_high} cold=${report.universe.tierDistribution.tier1_cold} proven-low=${report.universe.tierDistribution.tier2_provenLow}`,
    `  MEMORY edge used distribution: ${report.global.memoryEdgeUsedDistribution.map(r => `${r.used}=${r.count}`).join(', ')}`,
    ``,
    `(a) evidence starvation: never-injected=${a_neverInjected.length}, injected-but-all-used-NULL=${a_allUsedNull.length} (combined ${report.a_evidenceStarvation.combined}/${universe.length})`,
    `(b) eviction exposure: ungated at-risk pool=${b_atRisk.length}; threshold-gated next-sweep evictions=${b_nextSweep.length}`,
    `(c) contradicted high-risk subset of (b): ${c_atRiskSupersede.length} (universe supersede-winners=${report.c_contradictedHighRisk.universeSupersedeWinners}, provenance-linked=${report.c_contradictedHighRisk.universeProvenanceLinked})`,
    ``,
    `ARCHIVED retrospective: ${archivedCount} archived PROJECT memories; ` +
      `${bestRewriteByArchived.size} have any later ACTIVE neighbor; ` +
      `${wrongfulKillSuspects.length} wrongful-kill suspects (cosine ≥ ${SAME_TOPIC_SIM_FLOOR})`,
    ``,
    `Full detail: ${join(outDir, 'report.json')}`,
  ]
  console.log(lines.join('\n'))

  await prisma.$disconnect()
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
