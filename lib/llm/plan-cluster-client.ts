import { GENERATION_MODEL } from '@/lib/ai/models'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────

/** One unprocessed idea fed into Stage-1 clustering. `sourceContext` is the
 *  light free-text origin captured with the idea (may be absent). `evidence`
 *  is a list of human-readable lines summarising attached Slack/web/Figma
 *  sources (see `summariseIdeaEvidence`); absent or empty means no attached
 *  evidence and is omitted from the prompt entirely. */
export interface ClusterIdeaInput {
  id: string
  statement: string
  sourceContext?: string | null
  evidence?: string[] | null
}

export interface PlanClusterCluster {
  name: string
  /** One sentence: what these ideas jointly point at. */
  thrust: string
  ideaIds: string[]
}

export interface PlanClusterOutput {
  clusters: PlanClusterCluster[]
  /** Ids of ideas that fit no cluster — an explicit escape valve, never force-fit. */
  orphans: string[]
}

// ── Schema ────────────────────────────────────────────────────────────────────

const ClusterSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Short human-readable label naming the cluster'),
  thrust: z
    .string()
    .min(1)
    .describe(
      'One sentence stating what the ideas in this cluster jointly point at'
    ),
  ideaIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Ids of the ideas assigned to this cluster (from the input set)'),
})

// A hard ceiling of 6 clusters encodes the "do not fragment" half of the
// 3-6 constraint at the schema level (a ceiling never forces force-fit). The
// 3-6 target itself lives in the prompt: forcing a floor of 3 in the schema
// would make the SDK reject legitimately-small or highly-coherent pools, which
// contradicts the "禁止硬塞 / no force-fit" rule. orphans is the escape valve.
const PlanClusterSchema = z.object({
  clusters: z
    .array(ClusterSchema)
    .max(6)
    .describe('The coherent clusters (aim for 3-6)'),
  orphans: z
    .array(z.string().min(1))
    .describe(
      'Ids of ideas that fit no cluster — list them here, never force-fit'
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

export const PLAN_CLUSTER_SYSTEM_PROMPT = `You are a product strategist running the first stage of a design-thinking converter that turns a team's scattered ideas into an executable plan.

You are given a pool of unprocessed ideas, each with an id, a statement, and sometimes a light origin context. Your job is to group ideas that share an underlying thrust — the direction they jointly point at — and to be honest about ideas that stand alone.

Rules:
- Produce 3-6 coherent clusters. Fewer than 3 only if the pool is genuinely too small or too uniform to split; never more than 6 — merge related ideas rather than fragmenting.
- Each cluster needs a short "name" and a one-sentence "thrust" that states what the ideas jointly point at (the shared intent), NOT a mere list of the ideas.
- Assign every idea by its id. An idea that does not genuinely belong to any cluster's thrust goes in "orphans". Do NOT force an unrelated idea into a cluster to make it fit — a truthful orphan is better than a forced member.
- Every input idea id must appear EXACTLY ONCE across all clusters and orphans — never drop an id, never invent an id that was not in the input, never assign the same id twice.
- Cluster by shared thrust/intent, not by superficial keyword overlap.
- Some ideas carry an "evidence" list (attached Slack/web/Figma sources) — weigh shared or overlapping evidence as a signal that ideas jointly point at the same thrust.`

// ── Prompt builder ──────────────────────────────────────────────────────────

export function buildPlanClusterPrompt(ideas: ClusterIdeaInput[]): string {
  const lines = ideas.map(idea => {
    const ctx = idea.sourceContext?.trim()
    const ctxPart = ctx ? `\n    context: ${ctx}` : ''
    const evidencePart = idea.evidence?.length
      ? `\n    evidence:\n${idea.evidence.map(line => `      - ${line}`).join('\n')}`
      : ''
    return `- id: ${idea.id}\n    statement: ${idea.statement}${ctxPart}${evidencePart}`
  })

  return `Idea pool (${ideas.length} unprocessed idea${ideas.length === 1 ? '' : 's'}):
${lines.join('\n')}

Group these into 3-6 coherent clusters. Put ideas that fit no cluster in orphans. Return every id exactly once.`
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Stage-1 clustering: group an unprocessed idea pool into 3-6 clusters plus an
 * explicit orphan list. `generateObject` performs schema validation and SDK
 * retries; a malformed model response therefore throws rather than returning a
 * partial result.
 *
 * On top of that, we RECONCILE the returned ids against the input pool rather
 * than hard-failing on any imperfection: with a 15-long-cuid pool the model
 * very easily echoes one id short or duplicates one, and throwing there would
 * FAIL the entire run over a cosmetic blemish. Instead we tolerate the noise —
 * unknown/duplicate ids are dropped with a warning, and (the load-bearing
 * invariant) any input id the model omitted is reassigned to orphans so no idea
 * is ever silently lost. See `reconcileClusterOutput`.
 */
export async function callPlanClusterLLM(
  ideas: ClusterIdeaInput[]
): Promise<PlanClusterOutput> {
  const prompt = buildPlanClusterPrompt(ideas)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: PlanClusterSchema,
    system: PLAN_CLUSTER_SYSTEM_PROMPT,
    prompt,
  })

  return reconcileClusterOutput(ideas, object)
}

/**
 * Reconcile a raw model clustering against the input pool without throwing.
 *
 * Invariants:
 * - **Never drop an idea.** Every input id appears exactly once in the result:
 *   ids the model omitted are appended to `orphans`.
 * - **Tolerate id noise.** An id not in the input pool (hallucinated) or a
 *   second occurrence of an already-placed id is excluded and warned, not
 *   thrown — a single blemish never hard-fails the run.
 * - First placement wins: an id kept in a cluster is not re-added from orphans
 *   (or a later cluster), preserving the model's primary assignment.
 * - A cluster left empty after filtering is dropped (clusters carry ≥1 idea).
 */
export function reconcileClusterOutput(
  ideas: ClusterIdeaInput[],
  output: PlanClusterOutput
): PlanClusterOutput {
  const inputIds = new Set(ideas.map(i => i.id))
  const placed = new Set<string>()
  const unknownIds: string[] = []
  const duplicateIds: string[] = []

  // Keep only in-pool, not-yet-placed ids; record why anything is excluded.
  const keep = (ids: string[]): string[] =>
    ids.filter(id => {
      if (!inputIds.has(id)) {
        unknownIds.push(id)
        return false
      }
      if (placed.has(id)) {
        duplicateIds.push(id)
        return false
      }
      placed.add(id)
      return true
    })

  const clusters = output.clusters
    .map(c => ({ ...c, ideaIds: keep(c.ideaIds) }))
    .filter(c => c.ideaIds.length > 0)

  const orphans = keep(output.orphans)

  // The invariant: any input id the model never placed goes to orphans so it is
  // carried forward, never silently lost.
  const missing = ideas.map(i => i.id).filter(id => !placed.has(id))
  if (missing.length > 0) orphans.push(...missing)

  if (unknownIds.length || duplicateIds.length || missing.length) {
    logger.warn('plan-cluster: reconciled imperfect model ids', {
      inputCount: inputIds.size,
      unknownIds,
      duplicateIds,
      missingReassignedToOrphans: missing,
    })
  }

  return { clusters, orphans }
}
