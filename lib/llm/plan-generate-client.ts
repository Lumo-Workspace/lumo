import { GENERATION_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────
//
// Stage 3 (成计划) of the 转换器 state machine. Input is the gate-B-confirmed
// alignment judgment — the full set of clusters, each carrying its alignment
// label and whether a human starred it at gate B. Only the (≤2) starred ALIGNED
// clusters get a plan draft; everything else is deliberately shelved.

/** Alignment verdict a cluster carries out of gate B (Stage 2 · 对齐). */
export type AlignmentLabel = 'ALIGNED' | 'UNRELATED' | 'CONFLICT'

/** One cluster of ideas as confirmed at gate B. */
export interface AlignedCluster {
  clusterId: string
  label: AlignmentLabel
  /** Human starred it at gate B — the explicit "plan this" signal. */
  starred: boolean
  /** Short human-readable theme for the cluster. */
  theme: string
  /** The idea statements grouped into this cluster. */
  ideas: string[]
}

export interface PlanGenerateInput {
  /** Team priority text in effect at run start (frozen snapshot), if any. */
  priority: string | null
  /** The FULL gate-B-confirmed judgment — all clusters, all labels. */
  clusters: AlignedCluster[]
}

export type TaskSize = 'S' | 'M' | 'L'

export interface PlanTaskDraft {
  title: string
  /** One sentence — why this task matters. */
  why: string
  size: TaskSize
}

export interface ClusterPlanDraft {
  clusterId: string
  /** One-sentence goal for this cluster. */
  goalStatement: string
  /** 4–8 concrete tasks. */
  tasks: PlanTaskDraft[]
  /** One-sentence bet / assumption (赌注旁注) — a side note, not a criterion. */
  assumptionNote: string
}

export interface PlanGenerateOutput {
  drafts: ClusterPlanDraft[]
  /** 人话总述 — the advisor's recommendation prose. */
  prose: string
}

// ── Schema ────────────────────────────────────────────────────────────────────

const PlanTaskSchema = z.object({
  title: z.string().describe('Imperative, concrete task title'),
  why: z
    .string()
    .describe(
      'One substantive sentence: why this task matters / what it unblocks'
    ),
  size: z
    .enum(['S', 'M', 'L'])
    .describe('Rough effort: S (a sitting), M (a day or two), L (a week+)'),
})

const ClusterPlanDraftSchema = z.object({
  clusterId: z
    .string()
    .describe('The clusterId this draft plans for — copy it verbatim'),
  goalStatement: z
    .string()
    .describe(
      'A single sentence stating the goal this cluster is really after'
    ),
  tasks: z
    .array(PlanTaskSchema)
    .min(4)
    .max(8)
    .describe('Between 4 and 8 tasks that deliver the goal'),
  assumptionNote: z
    .string()
    .describe(
      'One sentence naming the biggest bet/assumption behind this plan (a side note, not a task)'
    ),
})

export const PlanGenerateSchema = z.object({
  drafts: z.array(ClusterPlanDraftSchema),
  prose: z
    .string()
    .describe(
      "The advisor's hand-off note (人话总述): overview → why do the first cluster first → what to shelve → customization warnings"
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

export const PLAN_GENERATE_SYSTEM_PROMPT = `You are a senior engineering advisor handing a small dev team a recommendation. You have been given the 1–2 idea clusters a human decided are worth acting on now, plus the team's current priority.

Your job has two products:

1. drafts — one plan draft per given cluster. Each draft is:
   - goalStatement: ONE sentence naming what the cluster is really trying to achieve (the outcome, not the tasks).
   - tasks: 4–8 concrete tasks. Each task has a substantive "why" (what it unblocks or why it must exist — never filler like "important task"), and a size of S, M, or L that honestly reflects effort.
   - assumptionNote: ONE sentence naming the biggest bet this plan rides on — the thing that, if wrong, sinks it. This is a side note for the reader's judgment, NOT an acceptance criterion.

2. prose — a short advisor's hand-off note, written the way a staff engineer would talk it through, in this order:
   - Overview (总述): in a sentence or two, what these N ideas are really asking for — how many distinct things they amount to.
   - Why do the first cluster first: name which cluster to start with and why, tying it to the team priority when one is given.
   - What to shelve (放): say plainly which ideas/clusters you are NOT planning right now and why they can wait.
   - Customization warnings (定制陷阱提醒): flag where a task hides an assumption about this specific team/product that could be wrong — the places where blindly copying a generic plan would bite.

Rules:
- Recommend, don't hedge. It is an advisor's note, not a menu.
- Only plan the clusters you were given. Do not invent clusters or plan ones that were shelved.
- Ground the "why do X first" in the team priority when it is provided.
- No preamble, no emoji.`

// ── Selection (deterministic, pre-LLM) ─────────────────────────────────────────

/**
 * The plan stage acts ONLY on the ≤2 clusters a human starred as ALIGNED at
 * gate B. UNRELATED / CONFLICT / unstarred clusters are deliberately dropped.
 * "Top 1–2" = the first two qualifying clusters in the gate-B-confirmed order.
 */
export function selectClustersForPlanning(
  clusters: AlignedCluster[]
): AlignedCluster[] {
  return clusters.filter(c => c.starred && c.label === 'ALIGNED').slice(0, 2)
}

// ── Prompt ─────────────────────────────────────────────────────────────────────

export function buildPlanGeneratePrompt(
  priority: string | null,
  selected: AlignedCluster[]
): string {
  const priorityBlock = priority
    ? `Team priority (in effect now):\n${priority}`
    : 'Team priority: none set — no priority to sequence against.'

  const clusterBlocks = selected
    .map((c, i) => {
      const ideaLines = c.ideas.map(idea => `    - ${idea}`).join('\n')
      return `Cluster ${i + 1} (clusterId=${c.clusterId}) — ${c.theme}
  Ideas:
${ideaLines}`
    })
    .join('\n\n')

  return `${priorityBlock}

You have ${selected.length} starred cluster(s) to plan. Produce one draft per cluster (matching its clusterId) plus the advisor prose.

${clusterBlocks}`
}

// ── Client ────────────────────────────────────────────────────────────────────

export async function callPlanGenerateLLM(
  input: PlanGenerateInput
): Promise<PlanGenerateOutput> {
  const selected = selectClustersForPlanning(input.clusters)

  // Nothing starred/aligned → nothing to recommend. Never burn an LLM call.
  if (selected.length === 0) {
    return { drafts: [], prose: '' }
  }

  const prompt = buildPlanGeneratePrompt(input.priority, selected)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: PlanGenerateSchema,
    system: PLAN_GENERATE_SYSTEM_PROMPT,
    prompt,
  })

  // Guard: keep only drafts whose clusterId is one we actually selected, so a
  // hallucinated or capped-out cluster can never leak a draft downstream.
  const selectedIds = new Set(selected.map(c => c.clusterId))
  const drafts = object.drafts.filter(d => selectedIds.has(d.clusterId))

  return { drafts, prose: object.prose }
}
