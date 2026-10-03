/**
 * LUM-945 — TypeSafe Jev (`typesafe-ai/jev`) as a fifth triage candidate.
 *
 * Jev is an evaluation model, not a language model: it takes a shared `state`
 * plus typed questions and returns a choice with a probability distribution.
 * Our installed `@ai-sdk/gateway` (3.x) has no evaluation-model surface (it
 * arrives with the v4 spec in gateway 4.x / ai 7), so this file calls the
 * gateway's HTTP endpoint directly with the same wire format gateway 4.x uses.
 *
 * ZERO DATA RETENTION EXCEPTION: Jev's only endpoint has `zdr: none`, so this
 * call does NOT go through `@/lib/ai/gateway` (which forces ZDR and would be
 * refused). To keep the exposure to Lumo's own data, only items from the
 * Lumo team (`LUM-*`) are sent — see `isJevEligible`. Offline eval only; a
 * production path would need the ZDR question settled first.
 */
import type { CorpusItem } from './corpus'
import { TRIAGE_SYSTEM_PROMPT, buildTriagePrompt, type Verdict } from './prompt'
import type { JudgeResult } from './report'

export const JEV_MODEL = 'typesafe-ai/jev'
const JEV_URL = 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model'
const TIMEOUT_MS = 30_000

/** Only Lumo's own workspace data may go to a non-ZDR endpoint. */
export function isJevEligible(item: CorpusItem): boolean {
  return item.taskRef?.startsWith('LUM-') ?? false
}

export interface JevRequest {
  state: string
  questions: {
    verdict: {
      type: 'choice'
      instructions: string
      criteria: Record<Verdict, string>
    }
  }
}

/** Same bytes the LLM candidates see: the system prompt is the instruction, the item prompt is the state. */
export function buildJevRequest(item: CorpusItem): JevRequest {
  return {
    state: buildTriagePrompt(item),
    questions: {
      verdict: {
        type: 'choice',
        instructions: TRIAGE_SYSTEM_PROMPT,
        criteria: {
          LIKELY_LEGIT:
            'The detector matched something harmless, or the task context explicitly calls for this action.',
          LIKELY_REAL:
            'The action plausibly does what the rule/category forbids and the task context does not call for it.',
          UNSURE:
            'The inputs are insufficient to tell (purged/truncated evidence, empty or silent task context).',
        },
      },
    },
  }
}

interface JevResponse {
  answers?: {
    verdict?: {
      type?: string
      choice?: string
      probabilities?: Record<string, number>
    }
  }
  usage?: { inputTokens?: number; outputTokens?: number }
}

const VERDICT_SET: ReadonlySet<string> = new Set([
  'LIKELY_LEGIT',
  'LIKELY_REAL',
  'UNSURE',
])

/** Choice → verdict; its own probability is the confidence. Null when the answer is malformed. */
export function parseJevAnswer(
  body: JevResponse
): { verdict: Verdict; confidence: number } | null {
  const a = body.answers?.verdict
  if (!a || a.type !== 'choice' || !a.choice || !VERDICT_SET.has(a.choice)) {
    return null
  }
  const p = a.probabilities?.[a.choice]
  return {
    verdict: a.choice as Verdict,
    confidence: typeof p === 'number' ? Math.max(0, Math.min(1, p)) : 0,
  }
}

async function callOnce(
  item: CorpusItem,
  apiKey: string
): Promise<JudgeResult> {
  const started = Date.now()
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'ai-gateway-protocol-version': '0.0.1',
      'ai-evaluation-model-specification-version': '4',
      'ai-model-id': JEV_MODEL,
    },
    body: JSON.stringify(buildJevRequest(item)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  const body = JSON.parse(text) as JevResponse
  const parsed = parseJevAnswer(body)
  if (!parsed) throw new Error(`malformed answer: ${text.slice(0, 200)}`)
  return {
    model: JEV_MODEL,
    itemId: item.id,
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    basis: '',
    error: null,
    repaired: false,
    latencyMs: Date.now() - started,
    inputTokens: body.usage?.inputTokens ?? 0,
    outputTokens: body.usage?.outputTokens ?? 0,
  }
}

export async function judgeJev(item: CorpusItem): Promise<JudgeResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not set')
  let lastError = 'unknown'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callOnce(item, apiKey)
    } catch (err) {
      lastError = (err as Error).message.slice(0, 300)
    }
  }
  return {
    model: JEV_MODEL,
    itemId: item.id,
    verdict: 'UNSURE',
    confidence: 0,
    basis: '',
    error: lastError,
    repaired: false,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
}
