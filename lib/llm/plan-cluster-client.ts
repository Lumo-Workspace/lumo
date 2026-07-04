import { GENERATION_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────

/** One unprocessed idea fed into Stage-1 clustering. `sourceContext` is the
 *  light free-text origin captured with the idea (may be absent). */
export interface ClusterIdeaInput {
  id: string
  statement: string
  sourceContext?: string | null
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
- Cluster by shared thrust/intent, not by superficial keyword overlap.`

// ── Prompt builder ──────────────────────────────────────────────────────────

export function buildPlanClusterPrompt(ideas: ClusterIdeaInput[]): string {
  const lines = ideas.map(idea => {
    const ctx = idea.sourceContext?.trim()
    const ctxPart = ctx ? `\n    context: ${ctx}` : ''
    return `- id: ${idea.id}\n    statement: ${idea.statement}${ctxPart}`
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
 * partial result. On top of that, we verify the returned ids exactly partition
 * the input set — a dropped or invented id is a silent partial result and is
 * rejected with a thrown error.
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

  assertIdsPartitionInput(ideas, object)

  return object
}

/** Throw unless every input id appears exactly once across clusters+orphans and
 *  no unknown id was introduced — guards against a silently partial clustering. */
function assertIdsPartitionInput(
  ideas: ClusterIdeaInput[],
  output: PlanClusterOutput
): void {
  const inputIds = new Set(ideas.map(i => i.id))
  const seen = new Set<string>()

  const allAssigned = [
    ...output.clusters.flatMap(c => c.ideaIds),
    ...output.orphans,
  ]

  for (const id of allAssigned) {
    if (!inputIds.has(id)) {
      throw new Error(
        `plan-cluster: model returned unknown idea id "${id}" not present in the input pool`
      )
    }
    if (seen.has(id)) {
      throw new Error(
        `plan-cluster: model assigned idea id "${id}" more than once`
      )
    }
    seen.add(id)
  }

  if (seen.size !== inputIds.size) {
    const missing = [...inputIds].filter(id => !seen.has(id))
    throw new Error(
      `plan-cluster: model dropped ${missing.length} idea id(s) from the clustering: ${missing.join(', ')}`
    )
  }
}
