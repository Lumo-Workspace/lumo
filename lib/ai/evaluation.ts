/**
 * LUM-945 — the AI Gateway's EVALUATION-model endpoint (typed question →
 * probability), for models such as TypeSafe Jev that are not language models.
 *
 * The installed `@ai-sdk/gateway` (3.x) has no evaluation surface — it arrives
 * with the v4 spec in gateway 4.x / ai 7 — so this wrapper speaks the same
 * wire format directly: POST `<base>/v4/ai/evaluation-model` with
 * `{ state, questions }`. Auth matches `@/lib/ai/gateway`: AI_GATEWAY_API_KEY
 * locally, the Vercel OIDC token in deployments.
 *
 * NOT zero data retention. `@/lib/ai/gateway` forces ZDR on every inference
 * request; the evaluation models in the catalog have no ZDR endpoint, so a
 * forced ZDR flag would be refused. Callers decide what they may send.
 */

import { resolveAiRoute } from './routing'

const GATEWAY_EVALUATION_URL =
  'https://ai-gateway.vercel.sh/v4/ai/evaluation-model'
const PROTOCOL_VERSION = '0.0.1'
const SPEC_VERSION = '4'

export interface BooleanEvaluationInput {
  model: string
  /** The shared state the question is asked about. */
  state: string
  /** What to judge about the state. */
  instructions: string
  criteria: { true: string; false: string }
  timeoutMs: number
}

export interface BooleanEvaluationResult {
  /** Model-estimated P(true), clamped to [0, 1]. */
  probability: number
  inputTokens: number
}

/** Raised for any non-answer: HTTP error, timeout, malformed body. */
export class EvaluationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvaluationError'
  }
}

async function authToken(): Promise<string> {
  const key = process.env.AI_GATEWAY_API_KEY
  if (key) return key
  // Lazy: keeps the OIDC module off the static import graph (jest, scripts).
  const { getVercelOidcToken } = await import('@/lib/runtime/vercel-oidc')
  return getVercelOidcToken()
}

interface EvaluationResponse {
  answers?: Record<string, { type?: string; probability?: unknown }>
  usage?: { inputTokens?: number }
}

/** Pure: the boolean answer under `questionId`, or null when absent/malformed. */
export function readBooleanAnswer(
  body: EvaluationResponse,
  questionId: string
): number | null {
  const a = body.answers?.[questionId]
  if (!a || a.type !== 'boolean') return null
  if (typeof a.probability !== 'number' || !Number.isFinite(a.probability)) {
    return null
  }
  return Math.max(0, Math.min(1, a.probability))
}

const QUESTION_ID = 'answer'

export async function evaluateBoolean(
  input: BooleanEvaluationInput,
  fetchImpl: typeof fetch = fetch
): Promise<BooleanEvaluationResult> {
  // LUM-1019 — evaluation models exist only on the AI Gateway; a self-hosted
  // deployment routing direct (or with no AI at all) has nowhere to send this.
  if (resolveAiRoute().kind !== 'gateway') {
    throw new EvaluationError(
      'evaluation models need the AI Gateway (AI_GATEWAY_API_KEY); this deployment does not route through it'
    )
  }
  let res: Response
  try {
    res = await fetchImpl(GATEWAY_EVALUATION_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await authToken()}`,
        'ai-gateway-protocol-version': PROTOCOL_VERSION,
        'ai-evaluation-model-specification-version': SPEC_VERSION,
        'ai-model-id': input.model,
      },
      body: JSON.stringify({
        state: input.state,
        questions: {
          [QUESTION_ID]: {
            type: 'boolean',
            instructions: input.instructions,
            criteria: input.criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    })
  } catch (error) {
    throw new EvaluationError(
      `evaluation request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const text = await res.text()
  if (!res.ok) {
    throw new EvaluationError(
      `evaluation HTTP ${res.status}: ${text.slice(0, 200)}`
    )
  }
  let body: EvaluationResponse
  try {
    body = JSON.parse(text) as EvaluationResponse
  } catch {
    throw new EvaluationError('evaluation response is not JSON')
  }
  const probability = readBooleanAnswer(body, QUESTION_ID)
  if (probability === null) {
    throw new EvaluationError('evaluation response has no boolean answer')
  }
  return { probability, inputTokens: body.usage?.inputTokens ?? 0 }
}
