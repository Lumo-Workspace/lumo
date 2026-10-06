/**
 * LUM-988 (agentic verifier) — run `verifyFindings` over the findings a
 * replay already recorded, one agent per PR, against a local checkout of the
 * PR head (`checkout.ts`). The shell is gated by the hunt's own allow-list
 * (`checkHuntCommand`) and its output redacted and capped, as in production;
 * the only difference is where the command runs (here: the local checkout,
 * production: the sandbox VM's checkout of the same head).
 *
 *   DOTENV_CONFIG_PATH="$(git rev-parse --path-format=absolute --git-common-dir)/../.env.local" \
 *   npx tsx -r dotenv/config scripts/analysis/lum988-code-review-replay/verify.ts \
 *     --results results-sonnet55.json --run 0 --data <prepare.ts dir> --checkouts <root> --out verify.json \
 *     [--max-steps 16] [--concurrency 6] [--model anthropic/claude-sonnet-5.5] [--limit N]
 *     [--only-applicable] [--system-file verifier-prompt-v4.txt]
 *
 * Writes { [prUrl]: { results, steps, commands, inputTokens, outputTokens,
 * error, ms } }. `score-verify.py` scores a filtered run against the step3
 * judgement of the unfiltered one, without re-judging.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  verifyFindings,
  type VerifierFinding,
} from '../../../lib/llm/review-verifier-client'
import { checkHuntCommand } from '../../../lib/security-scan/hunt/shell-allowlist'
import { redactKnownSecrets } from '../../../lib/security-scan'
import { redactForInjection } from '../../../lib/security-scan/scan-secrets'
import { splitDiffByFile } from '../../../lib/security-scan/diff-lines'
import { prKey } from './pr-key'

const run = promisify(execFile)

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}

const resultsFile = opt('results')
const runIdx = Number(opt('run', '0'))
const checkouts = opt('checkouts')
const dataDir = opt('data')
const outFile = opt('out')
const maxSteps = Number(opt('max-steps', '16'))
const concurrency = Number(opt('concurrency', '6'))
const model = opt('model', '')
const limit = Number(opt('limit', '0'))
// Ablations: a system prompt to use instead of the shipped one.
const systemFile = opt('system-file', '')
const system = systemFile ? readFileSync(systemFile, 'utf8').trim() : ''
// LUM-988 follow-up: send the agent only the rows the production policy can
// reject (non-HIGH bugs), as production now does.
const onlyApplicable = process.argv.includes('--only-applicable')
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

/** Per-command output cap, as the hunt's per-command truncation. */
const OUTPUT_MAX = 6_000

async function localShell(cwd: string, command: string): Promise<string> {
  const gate = checkHuntCommand(command)
  if (!gate.ok) return `refused: ${gate.reason}`
  try {
    const { stdout, stderr } = await run('sh', ['-c', command], {
      cwd,
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    const text = redactKnownSecrets(`${stdout}${stderr ? `\n${stderr}` : ''}`)
    return text.length > OUTPUT_MAX
      ? `${text.slice(0, OUTPUT_MAX)}\n[output truncated at ${OUTPUT_MAX} chars — run a narrower command]`
      : text || '(no output)'
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number }
    const text = redactKnownSecrets(`${err.stdout ?? ''}${err.stderr ?? ''}`)
    return `exit ${err.code ?? '?'}\n${text.slice(0, OUTPUT_MAX)}`
  }
}

type Recorded = Record<
  string,
  { runs: Array<{ findings?: Omit<VerifierFinding, 'id'>[] }> }
>

async function main(): Promise<void> {
  const recorded = JSON.parse(readFileSync(resultsFile, 'utf8')) as Recorded
  const all = Object.keys(recorded)
  const prs = limit > 0 ? all.slice(0, limit) : all
  const out: Record<string, unknown> = {}
  const queue = [...prs]
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const findings = (recorded[url]!.runs[runIdx]?.findings ?? [])
        .map((f, i) => ({ ...f, id: `f${i}` }))
        .filter(
          f =>
            !onlyApplicable ||
            (f.severity !== 'HIGH' && !SECURITY_KINDS.has(f.kind))
        )
      const cwd = path.join(checkouts, 'co', prKey(url))
      if (findings.length === 0 || !existsSync(cwd)) {
        out[url] = {
          results: [],
          skipped: findings.length ? 'no checkout' : 'no findings',
        }
        continue
      }
      const cited = new Set(findings.map(f => f.filePath))
      const diff = splitDiffByFile(
        readFileSync(path.join(dataDir, prKey(url), 'diff.patch'), 'utf8')
      )
        .filter(s => s.path !== null && cited.has(s.path))
        .map(s => s.text)
        .join('\n')
      const t0 = Date.now()
      const res = await verifyFindings({
        findings,
        diff: redactForInjection(diff).text,
        runShell: cmd => localShell(cwd, cmd),
        maxSteps,
        timeoutMs: 240_000,
        ...(model ? { model } : {}),
        ...(system ? { system } : {}),
      })
      out[url] = { ...res, ms: Date.now() - t0 }
      const rej = res.results.filter(r => r.verdict === 'REJECTED').length
      const def = res.results.filter(r => r.defaulted).length
      process.stdout.write(
        `${url.split('github.com/')[1]} ${findings.length}f rejected=${rej} defaulted=${def} steps=${res.steps} cmds=${res.commands} in=${res.inputTokens} out=${res.outputTokens}${res.error ? ` ERR ${res.error.slice(0, 80)}` : ''}\n`
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
