import { FAST_MODEL } from '@/lib/ai/models'

export type SummaryKind = 'slack' | 'artifact' | 'document' | 'comments'

// Cheap, fast model — matches the project's sanctioned summarization model
// (see turn-summary.service.ts / memory/layer2-extract.ts). Routed through the
// gateway to deepseek-v4-flash (LUM-320) to cut cost vs the prior Haiku tier.
const MODEL_ID = FAST_MODEL

const MAX_INPUT_CHARS = 24_000

export const SUMMARY_PROMPTS: Record<SummaryKind, string> = {
  slack:
    'Summarize this Slack conversation for an engineer picking up the task. ' +
    '2-3 sentences, focus on decisions, blockers, and asks. No preamble.',
  artifact:
    'Summarize this spec/plan/design artifact in 2-3 sentences: what it ' +
    'covers and its key decisions. No preamble.',
  document:
    'Summarize this document in 2-3 sentences for an engineer. ' +
    'Focus on what it specifies or decides. No preamble.',
  comments:
    'Summarize this task comment thread in 2-3 sentences: status updates, ' +
    'decisions, and open questions. No preamble.',
}

/**
 * Unified LLM summarization for long free-text task-context sources
 * (Slack threads, artifacts, documents, comment threads). Callers in the
 * context-tiering pipeline use this at write/refresh time to cache a short
 * inline summary on the row, then expose the full body via retrieval.
 */
export const contentSummaryService = {
  async summarize(text: string, kind: SummaryKind): Promise<string> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return ''

    // Dynamic import is mandatory: @ai-sdk/gateway pulls in TransformStream at
    // module load, which crashes jest when imported statically. Loading it
    // lazily keeps this service directly unit-testable.
    const { generateText } = await import('ai')
    const { gateway } = await import('@/lib/ai/gateway')

    const { text: out } = await generateText({
      model: gateway(MODEL_ID),
      system: SUMMARY_PROMPTS[kind],
      prompt: trimmed.slice(0, MAX_INPUT_CHARS),
    })

    return out.trim()
  },
}
