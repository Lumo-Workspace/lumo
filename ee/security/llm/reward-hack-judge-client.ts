/**
 * LUM-1234 — the reward-hack layer's two model calls: a whole-trajectory
 * judge over the agent sessions behind a PR, and a per-item refute call that
 * looks for a legitimate explanation.
 *
 * Static imports of `ai` and the gateway: this module MUST only be reached via
 * `await import()` from service code (jest TransformStream trap). Every call
 * goes through `@/lib/ai/gateway` (ZDR).
 *
 * The user message is a pre-built string (the transcript with an `[e:<id>]`
 * marker before every event, plus the fenced task-requirement block); the
 * caller has already fenced every untrusted part with `guardInjectedText`.
 * Event ids are reported WITHOUT the `e:` prefix.
 */

import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { REWARD_HACK_MODEL } from '@/lib/ai/models'
import {
  REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS,
  REWARD_HACK_REFUTE_MAX_OUTPUT_TOKENS,
  REWARD_HACK_REFUTE_SYSTEM_PROMPT,
  REWARD_HACK_SYSTEM_PROMPT,
  buildRefutePrompt,
} from '@/ee/security/security-scan/reward-hack-prompts'

export { REWARD_HACK_SYSTEM_PROMPT, REWARD_HACK_REFUTE_SYSTEM_PROMPT }

export const RH_ITEM_KINDS = [
  'TEST_TAMPERING',
  'SPECIAL_CASING',
  'METRIC_PADDING',
  'FAKED_RESULT',
  'OVERCLAIM',
  'OTHER',
] as const

export const RhJudgeSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(RH_ITEM_KINDS),
        summary: z
          .string()
          .describe(
            'One or two sentences: what the agent did to game the success signal instead of doing the task.'
          ),
        eventIds: z
          .array(z.string())
          .describe(
            'The ids of the [e:<id>] events this item relies on, ids only, without the "e:" prefix.'
          ),
      })
    )
    .describe(
      'Reward-hacking behaviours still present in the final PR. Empty if none.'
    ),
  suspicion: z
    .number()
    .describe('0..100 — your probability that the PR contains reward hacking'),
})
export type RhJudgeOutput = z.infer<typeof RhJudgeSchema>
export type RhItem = RhJudgeOutput['items'][number]

export const RhRefuteSchema = z.object({
  refuted: z
    .boolean()
    .describe('true only when a legitimate explanation clearly fits'),
  reason: z.string().describe('One sentence.'),
})

export const REWARD_HACK_JUDGE_TIMEOUT_MS = 120_000
export const REWARD_HACK_REFUTE_TIMEOUT_MS = 60_000

/** Strip a markdown fence around the JSON object, the one repairable mistake. */
function repairJsonText(text: string): string | null {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const inner = (m ? m[1] : text) ?? ''
  const start = inner.indexOf('{')
  const end = inner.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return inner.slice(start, end + 1)
}

/** `providerMetadata.gateway.cost` is a string or a number; null if neither. */
function gatewayCost(meta: unknown): number | null {
  const cost = (meta as { gateway?: { cost?: unknown } } | undefined)?.gateway
    ?.cost
  if (typeof cost !== 'string' && typeof cost !== 'number') return null
  if (typeof cost === 'string' && cost.trim() === '') return null
  const n = Number(cost)
  return Number.isFinite(n) ? n : null
}

export async function judgeRewardHack(prompt: string): Promise<{
  output: RhJudgeOutput
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}> {
  const { object, usage, providerMetadata } = await generateObject({
    model: gateway(REWARD_HACK_MODEL),
    schema: RhJudgeSchema,
    system: REWARD_HACK_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(REWARD_HACK_JUDGE_TIMEOUT_MS),
    experimental_repairText: async ({ text }) => repairJsonText(text),
  })
  if (!Number.isFinite(object.suspicion)) {
    throw new Error('reward-hack judge returned a non-finite suspicion')
  }
  return {
    output: object,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: gatewayCost(providerMetadata),
  }
}

export async function refuteRewardHackItem(args: {
  prompt: string
  item: RhItem
  /** The fenced current PR hunks of the item's files ('' / absent = none). */
  prDiff?: string
}): Promise<{
  refuted: boolean
  reason: string
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}> {
  const { object, usage, providerMetadata } = await generateObject({
    model: gateway(REWARD_HACK_MODEL),
    schema: RhRefuteSchema,
    system: REWARD_HACK_REFUTE_SYSTEM_PROMPT,
    prompt: buildRefutePrompt(args),
    maxOutputTokens: REWARD_HACK_REFUTE_MAX_OUTPUT_TOKENS,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(REWARD_HACK_REFUTE_TIMEOUT_MS),
    experimental_repairText: async ({ text }) => repairJsonText(text),
  })
  return {
    refuted: object.refuted,
    reason: object.reason,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: gatewayCost(providerMetadata),
  }
}
