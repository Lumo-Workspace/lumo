/**
 * LUM-1158 — match one reviewer's findings to the developers' fixes, per PR,
 * with the same prompt and model for both reviewers. Cached in
 * <data>/judged.json under a tag; a tag is bound to its inputs (re-using it
 * with other inputs is refused).
 *
 *   # bot-a (its issues come from labels.json)
 *   … judge.ts --data <dir> --tag bot-a --reference
 *   # Lumo, shipped pipeline: replay run i + verifier + ranker policy
 *   … judge.ts --data <dir> --tag lumo-run0 --review review.json --run 0 \
 *       --verify verify-run0.json --rank rank-run0.json
 *   # Lumo, raw review (omit --verify/--rank)
 *
 * Prefix: DOTENV_CONFIG_PATH=<repo>/.env.local npx tsx -r dotenv/config
 * scripts/analysis/lum1158-review-quality-bench/judge.ts. ZDR gateway only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { generateObject } from 'ai'
import { gateway } from '../../../lib/ai/gateway'
import { REASONING_MODEL } from '../../../lib/ai/models'
import { redactForInjection } from '../../../lib/security-scan/scan-secrets'
import {
  REFERENCE_LABEL,
  keptLumoFindings,
  lumoBenchFinding,
  scorePr,
  type BenchFinding,
  type JudgedPr,
  type PrLabels,
  type ReplayRunResult,
  type Usage,
} from './bench-lib'
import { MatchSchema, matchPrompt } from './prompts'

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T
const abs = (f: string) => (f ? path.resolve(f) : '')

const dataDir = opt('data')
const tag = opt('tag')
const isReference = process.argv.includes('--reference')
const reviewFile = isReference ? '' : opt('review')
const runIdx = Number(opt('run', '0'))
const verifyFile = opt('verify', '')
const rankFile = opt('rank', '')
const model = opt('model', REASONING_MODEL)
const concurrency = Number(opt('concurrency', '8'))
const JUDGE_TIMEOUT_MS = 180_000

type Judged = { params: Record<string, unknown> } & Record<
  string,
  Record<string, JudgedPr> | Record<string, unknown>
>

const log = (s: string) => process.stdout.write(`${s}\n`)

function findingsFor(
  url: string,
  labels: PrLabels | undefined,
  review: Record<string, { runs: ReplayRunResult[] }>,
  verify: Record<string, { results?: Array<{ id: string; verdict: string }> }>,
  rank: Record<string, { ranking?: Array<{ id: string; p: number }> }>
): BenchFinding[] | string | null {
  // Not ready yet (labels missing / PR not replayed): leave unjudged so a
  // re-run fills it in — never cache it as a scored empty row.
  if (isReference) return labels?.reference ?? null
  if (!review[url]?.runs[runIdx]) return null
  const kept = keptLumoFindings(
    review[url]?.runs[runIdx],
    verifyFile ? verify[url] : undefined,
    rankFile ? rank[url] : undefined
  )
  if (!kept) return 'no Lumo findings list (over cap or error)'
  return kept.map(lumoBenchFinding)
}

async function main(): Promise<void> {
  const meta = readJson<Record<string, { id: string; source: string }>>(
    path.join(dataDir, 'meta.json')
  )
  const labels = readJson<Record<string, PrLabels>>(
    path.join(dataDir, 'labels.json')
  )
  const review = reviewFile
    ? readJson<Record<string, { runs: ReplayRunResult[] }>>(reviewFile)
    : {}
  const verify = verifyFile ? readJson<Record<string, never>>(verifyFile) : {}
  const rank = rankFile ? readJson<Record<string, never>>(rankFile) : {}
  const outFile = path.join(dataDir, 'judged.json')
  const judged: Judged = existsSync(outFile)
    ? readJson(outFile)
    : { params: {} }
  const params = {
    reviewer: isReference ? REFERENCE_LABEL : 'lumo',
    review: abs(reviewFile),
    run: isReference ? null : runIdx,
    verify: abs(verifyFile),
    rank: abs(rankFile),
    model,
  }
  const prev = judged.params[tag]
  if (prev && JSON.stringify(prev) !== JSON.stringify(params))
    throw new Error(
      `tag ${tag} was judged with ${JSON.stringify(prev)}: use a new --tag`
    )
  judged.params[tag] = params
  const rows = (judged[tag] ??= {}) as Record<string, JudgedPr>

  const urls = Object.keys(meta).filter(
    u => !(isReference && meta[u]!.source !== 'oss') && labels[u]?.fixes
  )
  const queue = urls.filter(u => !rows[u])
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const fixes = labels[url]!.fixes!
      const found = findingsFor(url, labels[url], review, verify, rank)
      if (found === null) {
        log(
          `${meta[url]!.id} ${tag} not ready (no labels / not replayed), left unjudged`
        )
        continue
      }
      // Production posts nothing for these (over cap / error): scored as an
      // empty review on purpose — recall 0, like the shipped behaviour.
      if (typeof found === 'string') {
        rows[url] = {
          score: scorePr([], fixes, []),
          findings: [],
          matches: [],
          skipped: found,
        }
        continue
      }
      try {
        let matches: JudgedPr['matches'] = []
        let usage: Usage | undefined
        if (found.length && fixes.length) {
          const res = await generateObject({
            model: gateway(model),
            schema: MatchSchema,
            prompt: matchPrompt({
              findings: found.map(f => ({
                ...f,
                text: redactForInjection(f.text).text,
              })),
              fixes,
            }),
            abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
          })
          matches = res.object.matches
          usage = {
            inputTokens: res.usage.inputTokens ?? 0,
            outputTokens: res.usage.outputTokens ?? 0,
          }
        }
        const score = scorePr(found, fixes, matches)
        rows[url] = {
          score,
          findings: found,
          matches,
          ...(usage ? { usage } : {}),
        }
        log(
          `${meta[url]!.id} ${tag} findings ${score.matchedFindings}/${score.findings} fixes ${score.matchedFixes}/${score.fixes}`
        )
      } catch (e) {
        // Left unjudged: a re-run of the same command fills it in.
        log(
          `${meta[url]!.id} ${tag} FAILED ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`
        )
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: concurrency }, worker))
  } finally {
    writeFileSync(outFile, JSON.stringify(judged, null, 1))
  }
  log(
    `wrote ${outFile} (${Object.keys(rows).length}/${urls.length} judged for ${tag})`
  )
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
