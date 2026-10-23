/**
 * LUM-1304 — replay a captured pre-merge checks input (capture.ts) against
 * the model, one call at a time, and record how each call ended: latency,
 * finish reason, token usage, the gateway's serving provider, and whether
 * the answer validates against `PreMergeChecksAnswerSchema`.
 *
 *   DOTENV_CONFIG_PATH=/abs/main-checkout/.env.local \
 *     npx tsx -r dotenv/config scripts/analysis/lum1304-pre-merge-probe/probe.ts \
 *     --input /abs/scratch/pr1681.json --variant shipped --n 10 [--model <id>] \
 *     [--only alibaba,azure]   # object / text: gateway hosts to route to
 *
 * Variants:
 *   shipped — `runPreMergeChecksModel` itself, as deployed (its own timeout).
 *   object  — bare `generateObject` with the shipped schema, no repair, a
 *             long timeout: shows what the shipped call would do untimed.
 *   text    — `generateText` with the same system prompt and prompt, no
 *             schema: shows whether the model answers at all.
 *
 * Prints one JSON line per call and a summary; never prints prompt text.
 */
import { readFileSync } from 'node:fs'
import { generateObject, generateText, NoObjectGeneratedError } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import { MEMORY_JUDGE_MODEL } from '@/lib/ai/models'
import {
  PRE_MERGE_CHECKS_SYSTEM_PROMPT,
  PreMergeChecksAnswerSchema,
  buildPreMergeChecksPrompt,
  runPreMergeChecksModel,
  type PreMergeChecksAnswer,
  type PreMergeChecksPromptInput,
} from '@/ee/security/llm/pre-merge-checks-client'

const UNTIMED_MS = 240_000

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`missing --${name}`)
  return v
}

interface CallRecord {
  i: number
  ms: number
  ok: boolean
  error?: string
  finishReason?: string
  outputTokens?: number
  reasoningTokens?: number
  textChars?: number
  provider?: string
  /** `<check>=<verdict>` and `<requirement>=<outcome>`, no prose. */
  verdicts?: string
}

function verdictsOf(answer: PreMergeChecksAnswer): string {
  return answer.results
    .map(r =>
      [
        `${r.id}=${r.verdict}`,
        ...r.requirements.map(q => `${q.id}=${q.outcome}`),
      ].join(' ')
    )
    .join(' ')
}

function servingProvider(meta: unknown): string | undefined {
  const routing = (
    meta as { gateway?: { routing?: { finalProvider?: string } } } | undefined
  )?.gateway?.routing
  return routing?.finalProvider
}

async function once(
  variant: string,
  model: string,
  only: string[] | null,
  input: PreMergeChecksPromptInput
): Promise<Omit<CallRecord, 'i' | 'ms'>> {
  if (variant === 'shipped') {
    return {
      ok: true,
      verdicts: verdictsOf(await runPreMergeChecksModel(input)),
    }
  }
  const common = {
    model: gateway(model),
    system: PRE_MERGE_CHECKS_SYSTEM_PROMPT,
    prompt: buildPreMergeChecksPrompt(input),
    abortSignal: AbortSignal.timeout(UNTIMED_MS),
    ...(only ? { providerOptions: { gateway: { only } } } : {}),
  }
  if (variant === 'object') {
    const r = await generateObject({
      ...common,
      schema: PreMergeChecksAnswerSchema,
    })
    return {
      ok: true,
      finishReason: r.finishReason,
      outputTokens: r.usage.outputTokens,
      reasoningTokens: r.usage.reasoningTokens,
      provider: servingProvider(r.providerMetadata),
      verdicts: verdictsOf(r.object),
    }
  }
  if (variant === 'text') {
    const r = await generateText(common)
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(r.text)
    let parsed: ReturnType<typeof PreMergeChecksAnswerSchema.safeParse> | null =
      null
    try {
      parsed = PreMergeChecksAnswerSchema.safeParse(
        JSON.parse((m ? m[1] : r.text) ?? '')
      )
    } catch {
      parsed = null
    }
    return {
      ok: parsed?.success ?? false,
      ...(parsed?.success ? { verdicts: verdictsOf(parsed.data) } : {}),
      finishReason: r.finishReason,
      outputTokens: r.usage.outputTokens,
      reasoningTokens: r.usage.reasoningTokens,
      textChars: r.text.length,
      provider: servingProvider(r.providerMetadata),
    }
  }
  throw new Error(`unknown variant ${variant}`)
}

async function main() {
  const { input } = JSON.parse(readFileSync(arg('input'), 'utf8')) as {
    input: PreMergeChecksPromptInput
  }
  const variant = arg('variant', 'shipped')
  const n = Number(arg('n', '10'))
  const model = arg('model', MEMORY_JUDGE_MODEL)
  const onlyArg = arg('only', '')
  const only = onlyArg ? onlyArg.split(',') : null
  const records: CallRecord[] = []
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    let rec: CallRecord
    try {
      rec = { i, ms: 0, ...(await once(variant, model, only, input)) }
    } catch (error) {
      rec = {
        i,
        ms: 0,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 160) : 'error',
      }
      if (NoObjectGeneratedError.isInstance(error)) {
        rec.finishReason = error.finishReason
        rec.outputTokens = error.usage?.outputTokens
        rec.reasoningTokens = error.usage?.reasoningTokens
        rec.textChars = error.text?.length
        rec.provider = servingProvider(
          (error.response as { providerMetadata?: unknown } | undefined)
            ?.providerMetadata
        )
      }
    }
    rec.ms = Date.now() - t0
    records.push(rec)
    process.stdout.write(`${JSON.stringify(rec)}\n`)
  }
  const ok = records.filter(r => r.ok).length
  const ms = records.map(r => r.ms).sort((a, b) => a - b)
  process.stdout.write(
    `${JSON.stringify({ variant, model, only, n, ok, p50ms: ms[Math.floor(n / 2)], maxms: ms[n - 1] })}\n`
  )
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exitCode = 1
})
