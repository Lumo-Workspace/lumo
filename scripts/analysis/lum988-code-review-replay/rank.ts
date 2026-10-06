/**
 * LUM-988 (precision, step 2) — listwise ranking of a PR's findings after the
 * verifier. One call per PR, no tools: it sees the diff of the cited files and
 * every finding the verifier kept (with the verifier's reason), compares them
 * against each other, and gives each a probability that it is a real defect
 * the author should fix. `score-rank.py` sweeps a threshold over it.
 * Calls the production client (`rankFindings`, same prompt and diff cap), so
 * a replay measures what ships.
 *
 *   DOTENV_CONFIG_PATH="$(git rev-parse --path-format=absolute --git-common-dir)/../.env.local" \
 *   npx tsx -r dotenv/config scripts/analysis/lum988-code-review-replay/rank.ts \
 *     --results results-sonnet55.json --run 0 --verify verify-v3-run1.json \
 *     --data <prepare.ts dir> --out rank.json [--concurrency 6] [--model …] [--limit N]
 *
 * Writes { [prUrl]: { ranking: [{ id, p, reason }], inputTokens, outputTokens,
 * error } }. Ids are the replay's `f<i>`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CODE_REVIEW_MODEL } from '../../../lib/ai/models'
import { rankFindings } from '../../../lib/llm/review-ranker-client'
import {
  RANKER_DIFF_MAX_CHARS,
  RANKER_TIMEOUT_MS,
} from '../../../lib/security-scan/verifier'
import { citedDiff } from '../../../lib/services/review-verifier.service'
import { redactForInjection } from '../../../lib/security-scan/scan-secrets'
import { prKey } from './pr-key'

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}

const resultsFile = opt('results')
const runIdx = Number(opt('run', '0'))
const verifyFile = opt('verify')
const dataDir = opt('data')
const outFile = opt('out')
const concurrency = Number(opt('concurrency', '6'))
const model = opt('model', CODE_REVIEW_MODEL)
const limit = Number(opt('limit', '0'))
// Ablation: also hand the ranker the cited files at the head, up to N chars.
const contextChars = Number(opt('context-chars', '0'))

/** The cited files, line-numbered, smallest first, whole files under `max`. */
function citedFiles(dir: string, paths: string[], max: number): string {
  const files = paths
    .map(p => ({ p, f: path.join(dir, 'files', p) }))
    .filter(({ f }) => existsSync(f))
    .map(({ p, f }) => {
      const lines = readFileSync(f, 'utf8').split('\n')
      return `### ${p}\n${lines.map((l, i) => `${i + 1}: ${l}`).join('\n')}`
    })
    .sort((a, b) => a.length - b.length)
  let out = ''
  for (const text of files) {
    if (out.length + text.length + 2 > max) continue
    out += `${text}\n\n`
  }
  return out
}

// verify.ts SECURITY_KINDS: production never lets the verifier remove these.
const SECURITY_KINDS = new Set([
  'sql_injection',
  'command_injection',
  'xss',
  'ssrf',
  'path_traversal',
  'insecure_deserialization',
  'auth_bypass',
  'unsafe_eval',
  'weak_crypto',
  'hardcoded_credential',
  'csrf',
  'clickjacking_or_insecure_headers',
  'origin_or_host_validation',
  'open_redirect',
  'authz_logic',
])

interface Finding {
  kind: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  filePath: string
  line: number | null
  title: string
  detail: string
  evidence: string
}

type Recorded = Record<string, { runs: Array<{ findings?: Finding[] }> }>
type Verdicts = Record<
  string,
  { results?: Array<{ id: string; verdict: string; reason: string }> }
>

async function main(): Promise<void> {
  const recorded = JSON.parse(readFileSync(resultsFile, 'utf8')) as Recorded
  const verdicts = JSON.parse(readFileSync(verifyFile, 'utf8')) as Verdicts
  const all = Object.keys(recorded)
  const prs = limit > 0 ? all.slice(0, limit) : all
  const out: Record<string, unknown> = {}
  const queue = [...prs]
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const v = new Map(
        (verdicts[url]?.results ?? []).map(r => [r.id, r] as const)
      )
      // The verifier's rejections apply first, under the production policy.
      const kept = (recorded[url]!.runs[runIdx]?.findings ?? [])
        .map((f, i) => ({ f, id: `f${i}` }))
        .filter(({ f, id }) => {
          const r = v.get(id)
          const applicable =
            f.severity !== 'HIGH' && !SECURITY_KINDS.has(f.kind)
          return !(applicable && r?.verdict === 'REJECTED')
        })
      if (kept.length === 0) {
        out[url] = { ranking: [], skipped: 'no findings' }
        continue
      }
      const diff = redactForInjection(
        citedDiff(
          readFileSync(path.join(dataDir, prKey(url), 'diff.patch'), 'utf8'),
          new Set(kept.map(k => k.f.filePath)),
          RANKER_DIFF_MAX_CHARS
        )
      ).text
      const res = await rankFindings({
        findings: kept.map(({ f, id }) => ({
          ...f,
          id,
          verifierReason: v.get(id)?.reason ?? '',
        })),
        diff,
        ...(contextChars > 0
          ? {
              context: redactForInjection(
                citedFiles(
                  path.join(dataDir, prKey(url)),
                  [...new Set(kept.map(k => k.f.filePath))],
                  contextChars
                )
              ).text,
            }
          : {}),
        timeoutMs: RANKER_TIMEOUT_MS,
        model,
      })
      out[url] = res
      process.stdout.write(
        `${url.split('github.com/')[1]} ${kept.length}f ranked=${res.ranking.length} in=${res.inputTokens} out=${res.outputTokens}${res.error ? ` ERR ${res.error.slice(0, 100)}` : ''}\n`
      )
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  writeFileSync(outFile, JSON.stringify(out, null, 1))
  process.stdout.write(`wrote ${outFile}\n`)
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
