/**
 * Stage2 alignment LLM client for the design-thinking 转换器 (LUM-666, Spec2-4).
 *
 * Input: the human-confirmed clusters from gate A (闸门A) + the frozen priority
 * text (PlanRun.prioritySnapshot). Output: one alignment verdict per cluster
 * judged against the priority lens, plus a customization-trap flag.
 *
 * Uses REASONING_MODEL (桶1 VERIFIER tier) — aligning clusters against the team
 * priority is a judgment call where a wrong verdict silently steers the plan;
 * the trap rule (single-customer/single-source cluster) is the same kind of
 * high-value adversarial call the verifier tier exists for.
 *
 * Static imports of `ai` and `@ai-sdk/gateway` — this module must be
 * dynamic-imported from any code that jest statically loads (TransformStream
 * trap), and its callers must do the same. See lib/llm/code-rule-judge-client.ts.
 */

import { REASONING_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'

// ── Schema ────────────────────────────────────────────────────────────────────

export const ALIGN_VERDICTS = ['ALIGNED', 'UNRELATED', 'CONFLICT'] as const
export type AlignVerdict = (typeof ALIGN_VERDICTS)[number]

const PlanAlignSchema = z.object({
  clusters: z
    .array(
      z.object({
        clusterId: z.string().describe('Echo of the input cluster id'),
        verdict: z
          .enum(ALIGN_VERDICTS)
          .describe(
            'ALIGNED = same direction as the priority; UNRELATED = legitimate but off-priority (park it); CONFLICT = pulls against the priority'
          ),
        rationale: z
          .string()
          .describe('One line justifying the verdict / flagging the trap'),
        customizationTrap: z
          .boolean()
          .describe(
            'true when the cluster is supported ONLY by a single customer/source (one-off customization risk)'
          ),
      })
    )
    .describe('One entry per input cluster, in the same order.'),
})

// ── System prompt ─────────────────────────────────────────────────────────────

const PLAN_ALIGN_SYSTEM_PROMPT = `You are a strategy-alignment assistant for a small dev team's idea-to-plan converter.

You are given the team's current PRIORITY (a short plain-text declaration, or a note that none is declared) and a list of human-confirmed idea CLUSTERS. Each cluster has an id, a short label, and the idea statements it groups.

For EACH cluster, return exactly one entry echoing its clusterId with:
- verdict, one of:
  - ALIGNED   — the cluster pushes in the SAME direction as the priority. The rationale must say concretely HOW it serves the priority.
  - UNRELATED — the cluster is legitimate but does not bear on the current priority. This is NOT a rejection; the rationale should suggest parking it for now.
  - CONFLICT  — the cluster pulls AGAINST the priority or is in tension with it. The rationale should name the tension.
- rationale: ONE line (a single concise sentence).
- customizationTrap: boolean. Set TRUE when the cluster is supported ONLY by a single customer or a single source (e.g. every idea in it traces to one requester/one report). When true, the rationale MUST point out the single-source / one-off customization risk. This judgment is independent of the priority.

Each cluster is annotated with a \`sources:\` line — the number of distinct evidence sources backing it and their channels (or "none"). Treat this as the primary signal for customizationTrap: \`sources: 1 (...)\` is the single-source trap; higher counts or "none" (no attached evidence to judge from) are not.

Rules:
- If NO priority is declared, you cannot assess alignment: return verdict UNRELATED for every cluster and state in the rationale that the team priority is undeclared. Still assess customizationTrap normally.
- Return exactly one verdict per input cluster and nothing else. Be concise.`

// ── Input / output types ─────────────────────────────────────────────────────

export interface AlignClusterInput {
  /** Stable id of the confirmed cluster (echoed back on the verdict). */
  clusterId: string
  /** Short human-readable cluster name. */
  label: string
  /** The idea statements grouped into this cluster. */
  items: string[]
  /**
   * Aggregated evidence backing this cluster (distinct source count + which
   * channels), so the model's customizationTrap judgment has real signal
   * instead of guessing from the idea statements alone. `null`/omitted means
   * evidence lookup failed or produced nothing (rendered as "sources: none").
   */
  evidenceSources?: { count: number; channels: string[] } | null
}

export interface PlanAlignInput {
  clusters: AlignClusterInput[]
  /** Frozen priority text (PlanRun.prioritySnapshot); null/blank = undeclared. */
  priority: string | null
}

export interface PlanAlignClusterVerdict {
  clusterId: string
  verdict: AlignVerdict
  rationale: string
  customizationTrap: boolean
}

export interface PlanAlignResult {
  clusters: PlanAlignClusterVerdict[]
  /** Deterministic flag: whether a non-blank priority was supplied. */
  priorityDeclared: boolean
}

// ── Client ────────────────────────────────────────────────────────────────────

export function buildAlignPrompt(
  input: PlanAlignInput,
  priorityDeclared: boolean
): string {
  const priorityBlock = priorityDeclared
    ? (input.priority as string).trim()
    : '(none declared — team priority is undeclared)'

  const clusterBlock = input.clusters
    .map(c => {
      const items = c.items.map(i => `  - ${i}`).join('\n')
      const sources = c.evidenceSources
        ? `sources: ${c.evidenceSources.count} (${c.evidenceSources.channels.join(', ')})`
        : 'sources: none'
      return `[${c.clusterId}] ${c.label}\n  ${sources}\n${items}`
    })
    .join('\n\n')

  return `Team priority:
${priorityBlock}

Clusters:
${clusterBlock}`
}

export async function alignClusters(
  input: PlanAlignInput
): Promise<PlanAlignResult> {
  const priorityDeclared = !!(
    input.priority && input.priority.trim().length > 0
  )
  const prompt = buildAlignPrompt(input, priorityDeclared)

  const { object } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: PlanAlignSchema,
    system: PLAN_ALIGN_SYSTEM_PROMPT,
    prompt,
  })

  return { clusters: object.clusters, priorityDeclared }
}
