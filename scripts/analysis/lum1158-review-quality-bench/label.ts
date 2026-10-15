/**
 * LUM-1158 — the two labelling LLM steps, per PR, cached in <data>/labels.json:
 *
 *   truth      post.json → the fixes developers made after hash X (all rows)
 *   reference  reference.json → bot-a's discrete issues (oss rows)
 *
 * Every call goes through the ZDR gateway (`lib/ai/gateway`). The default
 * model is REASONING_MODEL — a different family from Lumo's review model, so
 * the labeller does not share the reviewer's blind spots or style.
 *
 *   DOTENV_CONFIG_PATH="$(git rev-parse --path-format=absolute --git-common-dir)/../.env.local" \
 *   npx tsx -r dotenv/config scripts/analysis/lum1158-review-quality-bench/label.ts \
 *     --data <dir> [--model <gateway id>] [--concurrency 6]
 *
 * Re-running only labels what is missing; usage tokens are recorded per call.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { generateObject } from 'ai'
import type { z } from 'zod'
import { gateway } from '../../../lib/ai/gateway'
import { REASONING_MODEL } from '../../../lib/ai/models'
import { redactForInjection } from '../../../lib/security-scan/scan-secrets'
import { prKey } from '../lum988-code-review-replay/pr-key'
import type { PrLabels, ReferenceReviewText, Usage } from './bench-lib'
import {
  ReferenceIssuesSchema,
  TruthSchema,
  referencePrompt,
  truthPrompt,
} from './prompts'

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}

const dataDir = opt('data')
const model = opt('model', REASONING_MODEL)
const concurrency = Number(opt('concurrency', '6'))
const LABEL_TIMEOUT_MS = 240_000

const redact = (s: string) => redactForInjection(s).text
const log = (s: string) => process.stdout.write(`${s}\n`)

async function call<T>(
  schema: z.ZodType<T>,
  prompt: string
): Promise<{ object: T; usage: Usage }> {
  const res = await generateObject({
    model: gateway(model),
    schema,
    prompt,
    abortSignal: AbortSignal.timeout(LABEL_TIMEOUT_MS),
  })
  return {
    object: res.object as T,
    usage: {
      inputTokens: res.usage.inputTokens ?? 0,
      outputTokens: res.usage.outputTokens ?? 0,
    },
  }
}

async function labelOne(
  url: string,
  prev: PrLabels | undefined
): Promise<PrLabels> {
  const dir = path.join(dataDir, prKey(url))
  const out: PrLabels = { ...(prev ?? { usage: {} }), model }
  if (!out.fixes) {
    const post = JSON.parse(
      readFileSync(path.join(dir, 'post.json'), 'utf8')
    ) as {
      title: string
      commits: Array<{ message: string; diff: string }>
    }
    const { object, usage } = await call<{
      fixes: Array<{ filePath: string | null; description: string }>
    }>(
      TruthSchema,
      truthPrompt({
        title: redact(post.title),
        commits: post.commits.map(c => ({
          message: redact(c.message),
          diff: redact(c.diff),
        })),
      })
    )
    out.fixes = object.fixes.map((f, i) => ({
      id: `A${i + 1}`,
      filePath: f.filePath,
      text: f.description,
    }))
    out.usage.truth = usage
  }
  const refFile = path.join(dir, 'reference.json')
  if (!out.reference && existsSync(refFile)) {
    const ref = JSON.parse(readFileSync(refFile, 'utf8')) as ReferenceReviewText
    const { object, usage } = await call<{
      issues: Array<{
        filePath: string | null
        line: number | null
        category: string
        description: string
      }>
    }>(
      ReferenceIssuesSchema,
      referencePrompt({
        inline: ref.inline.map(c => ({ ...c, body: redact(c.body) })),
        bodies: ref.bodies.map(redact),
      })
    )
    out.reference = object.issues.map((x, i) => ({
      id: `R${i + 1}`,
      filePath: x.filePath,
      line: x.line,
      category: x.category,
      text: x.description,
    }))
    out.usage.reference = usage
  }
  delete out.error
  return out
}

async function main(): Promise<void> {
  const urls = JSON.parse(
    readFileSync(path.join(dataDir, 'prs.json'), 'utf8')
  ) as string[]
  const file = path.join(dataDir, 'labels.json')
  const labels: Record<string, PrLabels> = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : {}
  const queue = [...urls]
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        labels[url] = await labelOne(url, labels[url])
        const l = labels[url]!
        log(
          `${url.split('github.com/')[1]} fixes=${l.fixes?.length} reference=${l.reference?.length ?? '-'}`
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        labels[url] = { ...(labels[url] ?? { model, usage: {} }), error: msg }
        log(`${url.split('github.com/')[1]} FAILED ${msg.slice(0, 160)}`)
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: concurrency }, worker))
  } finally {
    writeFileSync(file, JSON.stringify(labels, null, 1))
  }
  log(`wrote ${file}`)
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
