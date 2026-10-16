/**
 * LUM-988 — replay the PR scan's AI review over the Martian offline set
 * through the shipped pieces, in the order stage A runs them
 * (`lib/services/pr-security-scan.service.ts`, "A4: LLM judge"):
 *
 *   default path filters → size-cap plan (planPartialReview: whole, the
 *   files that fit, or no review) → judgeDiffTier → packSecurityDiff
 *   → loadReviewContext over the covered paths, capped by reviewContextBudget → redactForInjection on diff
 *   and context → judgeSecurity (CODE_REVIEW_MODEL, the production prompt and
 *   schema — with the diagram field when production asks for the diagram,
 *   LUM-1155 — the tier timeout); `review-input.ts` holds the first steps.
 *
 * Two differences from production, both stated: files are read from the
 * `prepare.ts` snapshot instead of `readRepoFile` (same PR-head content), and
 * `priorityPaths` is empty — production ranks the hunt trigger's sites first,
 * which only matters when a diff is over its tier and gets trimmed.
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.local" npx tsx -r dotenv/config \
 *     scripts/analysis/lum988-code-review-replay/replay.ts \
 *     --data <data dir> --out results.json [--runs 1] [--concurrency 8] [--limit N]
 *     [--ids <url,url>] [--server-config <checkouts root>]
 *     [--instructions <file>]
 *
 * LUM-1199: `--instructions` = `{ [prUrl]: PathInstruction[] }` (the
 * benchmark's `guidelines.ts`), rendered for the covered files exactly as
 * production does (`planPathInstructions` + `guardPromptLineText`) and paid
 * for out of the same context budget. Absent = no path instructions.
 *
 * Needs AI_GATEWAY_API_KEY (the real ZDR gateway, pinned to Anthropic).
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { judgeSecurity } from '@/ee/security/llm/security-judge-client'
import {
  REVIEW_PROMPT_MAX_CHARS,
  loadReviewContext,
  reviewContextBudget,
} from '@/ee/security/security-scan/review-context'
import {
  RELATED_MAX_CHARS,
  loadRelatedContext,
} from '@/ee/security/security-scan/related-context'
import {
  SERVER_CONFIG_MAX_CHARS,
  loadServerConfigContext,
  planServerConfigContext,
} from '@/ee/security/security-scan/server-config-context'
import { gitGrepSearch } from './git-grep-search'
import { redactForInjection } from '../../../lib/security-scan/scan-secrets'
import {
  judgeDiffTier,
  packSecurityDiff,
} from '@/ee/security/security-scan/truncate'
import { prKey } from './pr-key'
import { replayReviewInput } from './review-input'
import {
  instructionsForPr,
  parseInstructionsFile,
  replayPathInstructions,
  withVerifiedInstructionClaims,
} from '../lum1158-review-quality-bench/path-instructions-input'

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
// LUM-988 ablation: cross-file context searched in local PR-head checkouts
// (checkout.ts layout: <root>/co/<prKey>).
const relatedRoot = opt('related', '')
// LUM-1208: server config files the PR does not change, listed and read from
// the hashX checkouts (collect.ts layout: <root>/co/<prKey>) — production
// lists them through the contents API at the head.
const serverConfigRoot = opt('server-config', '')
// Only these PR urls (default: every PR in prs.json).
const onlyIds = opt('ids', '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

/**
 * Directory listing / file read inside one third-party checkout: never a
 * symlink (it could lead out of the checkout), never `.git`.
 */
function checkoutReaders(root: string) {
  const inside = (rel: string): string | null => {
    const abs = path.join(root, rel)
    if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null
    let cur = root
    for (const seg of rel.split('/').filter(Boolean)) {
      if (seg === '.git') return null
      cur = path.join(cur, seg)
      if (!existsSync(cur) || lstatSync(cur).isSymbolicLink()) return null
    }
    return abs
  }
  return {
    listDir: async (dir: string): Promise<string[]> => {
      const abs = inside(dir)
      if (abs === null || !lstatSync(abs).isDirectory()) return []
      return readdirSync(abs, { withFileTypes: true })
        .filter(e => e.isFile())
        .map(e => (dir ? `${dir}/${e.name}` : e.name))
    },
    readFile: async (rel: string): Promise<string | null> => {
      const abs = inside(rel)
      return abs !== null && lstatSync(abs).isFile()
        ? readFileSync(abs, 'utf8')
        : null
    },
  }
}
const instructionsFile = opt('instructions', '')
const instructionsByPr: Record<string, unknown> = instructionsFile
  ? parseInstructionsFile(readFileSync(instructionsFile, 'utf8'))
  : {}

export interface ReplayRun {
  /** LUM-1210: with the verified `pathInstruction` production stores. */
  findings: Array<
    Awaited<ReturnType<typeof judgeSecurity>>['findings'][number] & {
      pathInstruction: string | null
    }
  >
  ms: number
  diffChars: number
  contextChars: number
  contextFiles: number
  contextError: string | null
  relatedChars?: number
  /** LUM-1208 — config files sent (path list) and their chars. */
  serverConfigFiles?: string[]
  serverConfigChars?: number
  /** LUM-1199 — rendered path-instruction chars and entries sent. */
  instructionChars?: number
  instructionsSent?: number
  /** Production's size-cap plan (LUM-1144) and the files it left out. */
  plan?: 'WHOLE' | 'PARTIAL'
  excludedFiles?: string[]
  skippedFiles?: string[]
  /** LUM-1155 — the review was asked for the diagram too. */
  withSequenceDiagram?: boolean
}
type RunResult = ReplayRun | { skipped: 'JUDGE_OVER_CAP' } | { error: string }

async function reviewOnce(url: string): Promise<RunResult> {
  const dir = path.join(dataDir, prKey(url))
  const diff = readFileSync(path.join(dir, 'diff.patch'), 'utf8')
  // Production's path filters, size-cap plan and diagram decision.
  const input = replayReviewInput(diff)
  if (input.kind === 'OVER_CAP') return { skipped: 'JUDGE_OVER_CAP' }
  const tier = judgeDiffTier(input.judgeDiff)
  const capped = packSecurityDiff(input.judgeDiff, {
    priorityPaths: [],
    maxChars: tier.chars,
  })
  const instructions = replayPathInstructions(
    instructionsForPr(instructionsByPr, url),
    capped.covered
  )
  let serverConfigText = ''
  let serverConfigFiles: string[] = []
  if (serverConfigRoot) {
    const readers = checkoutReaders(
      path.join(serverConfigRoot, 'co', prKey(url))
    )
    const loaded = await loadServerConfigContext({
      plan: planServerConfigContext(capped.text),
      changedPaths: input.changedPaths,
      ...readers,
      maxChars: Math.min(
        SERVER_CONFIG_MAX_CHARS,
        reviewContextBudget(capped.text.length + instructions.text.length)
      ),
    })
    serverConfigText = loaded.text
    serverConfigFiles = loaded.included
  }
  const context = await loadReviewContext({
    paths: capped.covered,
    // Production: the instructions and the server config share the context
    // budget with the diff.
    maxChars: reviewContextBudget(
      capped.text.length + instructions.text.length + serverConfigText.length
    ),
    readFile: async p => {
      const f = path.join(dir, 'files', p)
      return existsSync(f) ? readFileSync(f, 'utf8') : null
    },
  })
  const diffText = redactForInjection(capped.text).text
  const contextText = redactForInjection(context.text).text
  let relatedText = ''
  if (relatedRoot) {
    const cwd = path.join(relatedRoot, 'co', prKey(url))
    const related = await loadRelatedContext({
      diff: capped.text,
      changedPaths: capped.covered,
      maxChars: Math.min(
        RELATED_MAX_CHARS,
        REVIEW_PROMPT_MAX_CHARS -
          diffText.length -
          contextText.length -
          instructions.text.length
      ),
      search: gitGrepSearch(cwd),
    })
    relatedText = redactForInjection(related.text).text
  }
  const t0 = Date.now()
  try {
    const { findings } = await judgeSecurity({
      diff: diffText,
      timeoutMs: tier.timeoutMs,
      context: contextText,
      ...(relatedText ? { related: relatedText } : {}),
      ...(serverConfigText ? { serverConfig: serverConfigText } : {}),
      ...(instructions.text ? { pathInstructions: instructions.text } : {}),
      ...(input.withSequenceDiagram ? { withSequenceDiagram: true } : {}),
    })
    return {
      // LUM-1210: the claim production would store, so the removal policy
      // (bench-lib keptLumoFindings, verify/rank) can exempt it.
      findings: withVerifiedInstructionClaims(findings, instructions.sent),
      ms: Date.now() - t0,
      diffChars: diffText.length,
      contextChars: contextText.length,
      contextFiles: context.included.length,
      contextError: context.error,
      relatedChars: relatedText.length,
      ...(serverConfigRoot
        ? { serverConfigFiles, serverConfigChars: serverConfigText.length }
        : {}),
      instructionChars: instructions.text.length,
      instructionsSent: instructions.sent.length,
      plan: input.kind,
      excludedFiles: input.excluded,
      skippedFiles: input.skipped,
      withSequenceDiagram: input.withSequenceDiagram,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function main(): Promise<void> {
  const all = JSON.parse(
    readFileSync(path.join(dataDir, 'prs.json'), 'utf8')
  ) as string[]
  const picked = onlyIds.length ? all.filter(u => onlyIds.includes(u)) : all
  const prs = limit > 0 ? picked.slice(0, limit) : picked
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
            ? `${x.findings.length}f/${x.contextFiles}ctx/${x.relatedChars ?? 0}rel/${x.instructionsSent ?? 0}pi/${x.serverConfigFiles?.length ?? 0}cfg/${Math.round(x.ms / 1000)}s`
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
