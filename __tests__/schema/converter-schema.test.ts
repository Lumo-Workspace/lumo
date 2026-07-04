/**
 * @jest-environment node
 *
 * LUM-663: Spec2-1 转换器 schema foundation.
 * A schema-parse test asserting the shape of the converter data foundation
 * directly against prisma/schema.prisma — the frozen contract for the地基:
 *   - PlanRun: per-team recoverable run, team-level (teamId + workspaceId,
 *     NO projectId), PlanRunStage enum, frozen inputIdeaIds snapshot.
 *   - PlanRunStageRecord: one row per (run, gate), @@unique([planRunId, kind]),
 *     the raw→humanConfirmed diff collection point.
 *   - Initiative: team-level strategic layer (= Linear Initiative, NO projectId),
 *     per-team @@unique([teamId, number]) visible id, InitiativeStatus enum.
 *   - Additive nullable FKs on Task (initiativeId/ideaId/sizeHint) and Idea
 *     (planRunId/initiativeId) — non-breaking, existing rows unaffected.
 */
import { readFileSync } from 'fs'
import path from 'path'

const schema = readFileSync(
  path.resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8'
)

/** Extract the body of a `model <name> { … }` block from the schema text. */
function modelBlock(name: string): string {
  const re = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, 'm')
  const m = schema.match(re)
  if (!m?.[1]) throw new Error(`model ${name} not found in schema.prisma`)
  return m[1]
}

/** Extract the body of an `enum <name> { … }` block from the schema text. */
function enumBlock(name: string): string {
  const re = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`, 'm')
  const m = schema.match(re)
  if (!m?.[1]) throw new Error(`enum ${name} not found in schema.prisma`)
  return m[1]
}

describe('LUM-663 converter schema foundation (Spec2-1)', () => {
  it('converter models and enums shape', () => {
    const planRun = modelBlock('PlanRun')
    const stageRecord = modelBlock('PlanRunStageRecord')
    const initiative = modelBlock('Initiative')

    // ── PlanRunStage enum: the 9-state recoverable machine ───────────────────
    const stage = enumBlock('PlanRunStage')
    for (const v of [
      'CLUSTERING',
      'CLUSTERS_READY',
      'ALIGNING',
      'ALIGNMENT_READY',
      'GENERATING',
      'DRAFT_READY',
      'MATERIALIZED',
      'ABANDONED',
      'FAILED',
    ]) {
      expect(stage).toMatch(new RegExp(`\\b${v}\\b`))
    }

    // ── PlanStageKind & InitiativeStatus enums ───────────────────────────────
    const kind = enumBlock('PlanStageKind')
    for (const v of ['CLUSTER', 'ALIGN', 'GENERATE'])
      expect(kind).toMatch(new RegExp(`\\b${v}\\b`))
    const initStatus = enumBlock('InitiativeStatus')
    for (const v of ['ACTIVE', 'DONE', 'DROPPED'])
      expect(initStatus).toMatch(new RegExp(`\\b${v}\\b`))

    // ── PlanRun: team-level (teamId + workspaceId), NO projectId ──────────────
    expect(planRun).toMatch(/^\s*teamId\s+String\s*$/m)
    expect(planRun).toMatch(/^\s*workspaceId\s+String\b/m)
    expect(planRun).not.toMatch(/projectId/)
    expect(planRun).toMatch(/stage\s+PlanRunStage\s+@default\(CLUSTERING\)/)
    expect(planRun).toMatch(/^\s*startedByMemberId\s+String\b/m)
    // frozen input snapshot + frozen priority text
    expect(planRun).toMatch(/^\s*inputIdeaIds\s+String\[\]/m)
    expect(planRun).toMatch(/^\s*priorityId\s+String\?/m)
    expect(planRun).toMatch(/^\s*prioritySnapshot\s+String\?/m)
    expect(planRun).toMatch(/^\s*proseDocument\s+String\?/m)
    expect(planRun).toMatch(/@@map\("plan_runs"\)/)

    // ── PlanRunStageRecord: one row per (run, gate) ──────────────────────────
    expect(stageRecord).toMatch(/^\s*kind\s+PlanStageKind\b/m)
    expect(stageRecord).toMatch(/@@unique\(\[planRunId,\s*kind\]\)/)
    // the raw→humanConfirmed diff collection point
    expect(stageRecord).toMatch(/^\s*llmRawOutput\s+Json\b/m)
    expect(stageRecord).toMatch(/^\s*humanConfirmedOutput\s+Json\?/m)
    expect(stageRecord).toMatch(/^\s*confirmedBy\s+String\?/m)
    expect(stageRecord).toMatch(/^\s*confirmedAt\s+DateTime\?/m)
    expect(stageRecord).toMatch(/@@map\("plan_run_stage_records"\)/)

    // ── Initiative: team-level strategic layer, NO projectId ─────────────────
    expect(initiative).toMatch(/^\s*teamId\s+String\s*$/m)
    expect(initiative).toMatch(/^\s*workspaceId\s+String\s*$/m)
    expect(initiative).not.toMatch(/projectId/)
    // per-team visible id (LUM-INIT-N)
    expect(initiative).toMatch(/^\s*number\s+Int\b/m)
    expect(initiative).toMatch(/@@unique\(\[teamId,\s*number\]\)/)
    expect(initiative).toMatch(/^\s*goalStatement\s+String\b/m)
    expect(initiative).toMatch(/^\s*assumptionNote\s+String\?/m)
    expect(initiative).toMatch(/status\s+InitiativeStatus\s+@default\(ACTIVE\)/)
    expect(initiative).toMatch(/@@map\("initiatives"\)/)
  })

  it('additive nullable columns on Task and Idea', () => {
    const task = modelBlock('Task')
    const idea = modelBlock('Idea')

    // ── Task: three additive nullable links to the converter layer ───────────
    expect(task).toMatch(/^\s*initiativeId\s+String\?/m)
    expect(task).toMatch(/^\s*ideaId\s+String\?/m)
    expect(task).toMatch(/^\s*sizeHint\s+SizeHint\?/m)

    // ── Idea: two additive nullable links ────────────────────────────────────
    expect(idea).toMatch(/^\s*planRunId\s+String\?/m)
    expect(idea).toMatch(/^\s*initiativeId\s+String\?/m)

    // ── SizeHint enum (coarse S/M/L) ─────────────────────────────────────────
    const size = enumBlock('SizeHint')
    for (const v of ['S', 'M', 'L'])
      expect(size).toMatch(new RegExp(`\\b${v}\\b`))

    // ── Every added column is optional (nullable) → non-breaking additive ────
    // No added column may be a required (non-`?`) scalar.
    expect(task).not.toMatch(/^\s*initiativeId\s+String\s*$/m)
    expect(task).not.toMatch(/^\s*ideaId\s+String\s*$/m)
    expect(idea).not.toMatch(/^\s*planRunId\s+String\s*$/m)
    expect(idea).not.toMatch(/^\s*initiativeId\s+String\s*$/m)
  })
})
