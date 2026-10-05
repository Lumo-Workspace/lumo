/**
 * LUM-988 — replay the PR scan's AI review over the Martian offline set
 * through the shipped pieces, in the order stage A runs them
 * (`lib/services/pr-security-scan.service.ts`, "A4: LLM judge"):
 *
 *   over-cap check (JUDGE_DIFF_BUDGET_TIERS) → judgeDiffTier → packSecurityDiff
 *   → loadReviewContext over the covered paths → redactForInjection on diff
 *   and context → judgeSecurity (CODE_REVIEW_MODEL, the production prompt and
 *   schema, the tier timeout)
 *
 * Two differences from production, both stated: files are read from the
 * `prepare.ts` snapshot instead of `readRepoFile` (same PR-head content), and
 * `priorityPaths` is empty — production ranks the hunt trigger's sites first,
 * which only matters when a diff is over its tier and gets trimmed.
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.local" npx tsx -r dotenv/config \
 *     scripts/analysis/lum988-code-review-replay/replay.ts \
 *     --data <data dir> --out results.json [--runs 1] [--concurrency 8] [--limit N]
 *
 * Needs AI_GATEWAY_API_KEY (the real ZDR gateway, pinned to Anthropic).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { judgeSecurity } from '../../../lib/llm/security-judge-client'
import { loadReviewContext } from '../../../lib/security-scan/review-context'
import { redactForInjection } from '../../../lib/security-scan/scan-secrets'
import {
  JUDGE_DIFF_BUDGET_TIERS,
  judgeDiffTier,
  packSecurityDiff,
} from '../../../lib/security-scan/truncate'
import { prKey } from './pr-key'

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}

const dataDir = opt('data')
const outFile = opt('out')
const runs = Number(opt('runs', '1'))
const concurrency = Number(opt('concurrency', '8'))
const limit = Number(opt('limit', '0'))

const capChars =
  JUDGE_DIFF_BUDGET_TIERS[JUDGE_DIFF_BUDGET_TIERS.length - 1]!.chars

export interface ReplayRun {
  findings: Awaited<ReturnType<typeof judgeSecurity>>['findings']
  ms: number
  diffChars: number
  contextChars: number
  contextFiles: number
  contextError: string | null
}
type RunResult = ReplayRun | { skipped: 'JUDGE_OVER_CAP' } | { error: string }

async function reviewOnce(url: string): Promise<RunResult> {
  const dir = path.join(dataDir, prKey(url))
  const diff = readFileSync(path.join(dir, 'diff.patch'), 'utf8')
  if (diff.length > capChars) return { skipped: 'JUDGE_OVER_CAP' }
  const tier = judgeDiffTier(diff)
  const capped = packSecurityDiff(diff, {
    priorityPaths: [],
    maxChars: tier.chars,
  })
  const context = await loadReviewContext({
    paths: capped.covered,
    readFile: async p => {
      const f = path.join(dir, 'files', p)
      return existsSync(f) ? readFileSync(f, 'utf8') : null
    },
  })
  const diffText = redactForInjection(capped.text).text
  const contextText = redactForInjection(context.text).text
  const t0 = Date.now()
  try {
    const { findings } = await judgeSecurity({
      diff: diffText,
      timeoutMs: tier.timeoutMs,
      context: contextText,
    })
    return {
      findings,
      ms: Date.now() - t0,
      diffChars: diffText.length,
      contextChars: contextText.length,
      contextFiles: context.included.length,
      contextError: context.error,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function main(): Promise<void> {
  const all = JSON.parse(
    readFileSync(path.join(dataDir, 'prs.json'), 'utf8')
  ) as string[]
  const prs = limit > 0 ? all.slice(0, limit) : all
  const out: Record<string, { runs: RunResult[] }> = {}
  const queue = [...prs]
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const results: RunResult[] = []
      for (let r = 0; r < runs; r++) results.push(await reviewOnce(url))
      out[url] = { runs: results }
      const tag = results
        .map(x =>
          'findings' in x
            ? `${x.findings.length}f/${x.contextFiles}ctx/${Math.round(x.ms / 1000)}s`
            : 'skipped' in x
              ? 'over-cap'
              : `ERR ${x.error.slice(0, 60)}`
        )
        .join(' ')
      process.stdout.write(`${url.split('github.com/')[1]} ${tag}\n`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  writeFileSync(outFile, JSON.stringify(out, null, 1))
  process.stdout.write(`wrote ${outFile} (${prs.length} PRs × ${runs} runs)\n`)
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
