/**
 * LUM-1003 — re-run the PR-review-todo / comments / session-summary cells of
 * the LUM-999 harness on before (origin/main) vs after (the LUM-1003 PR head).
 *
 *   npx tsx scripts/analysis/lum999-lumo-context-injection/run-lum1003.ts \
 *     --before <origin/main worktree> --after <PR head worktree> \
 *     --env-file .env.local --work ~/.cache/lumo-lum1003 \
 *     --models claude-haiku-4-5 --variants all-attacked --n 8 \
 *     --cap 10 --spent-offset 0.77 --per-episode 0.15 --concurrency 4
 *
 * Same sandbox, judge, loopback proxy and budget accounting as run.ts. Writes
 * results-lum1003/results.json + episodes.jsonl.gz (never LUM-999's files).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { CANARY_MARKER, PAYLOADS, TASK_IDENTIFIER } from './fixtures'
import {
  LEGIT_REVIEW_ASK,
  buildLum1003Variants,
  type Lum1003Variant,
} from './fixtures-lum1003'
import { judge, legitRenameDone } from './judge'
import { startGatewayProxy } from './proxy'
import { gitHead, renderArm, type ArmRender } from './render-arms'
import {
  encodeEpisodes,
  episodesJsonl,
  formatResultsJson,
  sha256Hex,
} from './report'
import {
  LUM1003_ARMS,
  renderLum1003Table,
  summarize1003,
  type Lum1003Arm,
  type Lum1003Record,
} from './report-lum1003'
import {
  AGENT_PROMPT,
  ALLOWED_TOOLS,
  DISALLOWED_TOOLS,
  TOOLS,
  createSandbox,
  runClaude,
  snapshotSandbox,
} from './sandbox'

const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh'

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (v !== undefined) return v
  if (fallback !== undefined) return fallback
  throw new Error(`missing --${name}`)
}

function readEnvKey(file: string, key: string): string {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(new RegExp(`^${key}=(.*)$`))
    if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error(`${key} not found in ${file}`)
}

function out(s: string): void {
  process.stdout.write(`${s}\n`)
}

function loadLedger(path: string): Lum1003Record[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as Lum1003Record)
}

async function main(): Promise<void> {
  const trees: Record<Lum1003Arm, string> = {
    before: resolve(arg('before')),
    after: resolve(arg('after')),
  }
  const work = resolve(arg('work', join(homedir(), '.cache', 'lumo-lum1003')))
  const models = arg('models', 'claude-haiku-4-5').split(',')
  const n = Number(arg('n', '8'))
  const cap = Number(arg('cap', '10'))
  const spentOffset = Number(arg('spent-offset', '0'))
  const perEpisode = Number(arg('per-episode', '0.15'))
  const concurrency = Number(arg('concurrency', '4'))
  const timeoutMs = Number(arg('timeout-sec', '420')) * 1000
  const claudeBin = arg('claude', join(homedir(), '.local', 'bin', 'claude'))
  const renderOnly = process.argv.includes('--render-only')
  const OUT_DIR = resolve(arg('out-dir', join(__dirname, 'results-lum1003')))

  // Which arms get episodes (both are always rendered).
  const runArms = arg('arms', LUM1003_ARMS.join(',')).split(',') as Lum1003Arm[]
  for (const a of runArms) {
    if (!(LUM1003_ARMS as readonly string[]).includes(a))
      throw new Error(`unknown arm ${a}`)
  }
  const all = buildLum1003Variants()
  const wanted = arg('variants', 'all-attacked')
  const variants: Lum1003Variant[] =
    wanted === 'all'
      ? all
      : wanted === 'all-attacked'
        ? all.filter(v => v.id !== 'clean')
        : wanted.split(',').map(id => {
            const v = all.find(x => x.id === id)
            if (!v) throw new Error(`unknown variant ${id}`)
            return v
          })

  mkdirSync(work, { recursive: true })
  const shas: Record<Lum1003Arm, string> = {
    before: gitHead(trees.before),
    after: gitHead(trees.after),
  }
  const renders: Record<Lum1003Arm, Map<string, ArmRender>> = {
    before: new Map(),
    after: new Map(),
  }
  for (const arm of LUM1003_ARMS) {
    const r = renderArm(trees[arm], all, join(work, `render-${arm}`))
    for (const x of r) renders[arm].set(x.id, x)
    out(`rendered ${r.length} variants through ${arm} @ ${shas[arm]}`)
  }
  const renderingMeta = {
    before: { tree: 'origin/main', sha: shas.before },
    after: { tree: 'LUM-1003 PR head', sha: shas.after },
    variants: all.map(v => ({
      id: v.id,
      sha256: Object.fromEntries(
        LUM1003_ARMS.map(a => [
          a,
          renders[a].get(v.id)?.sha256.slice(0, 16) ?? null,
        ])
      ),
    })),
  }
  if (renderOnly) {
    for (const arm of LUM1003_ARMS) {
      for (const v of all) {
        writeFileSync(
          join(work, `render-${arm}`, `${v.id}.md`),
          renders[arm].get(v.id)?.markdown ?? ''
        )
      }
    }
    out(JSON.stringify(renderingMeta, null, 2))
    return
  }

  const gatewayKey = readEnvKey(resolve(arg('env-file')), 'AI_GATEWAY_API_KEY')
  const ledgerPath = join(work, 'episodes.jsonl')
  const ledger = loadLedger(ledgerPath)
  const done = new Set(ledger.map(r => r.key))

  const queue: Array<{
    model: string
    arm: Lum1003Arm
    v: Lum1003Variant
    rep: number
  }> = []
  for (let rep = 1; rep <= n; rep++) {
    for (const v of variants) {
      for (const model of models) {
        for (const arm of runArms) {
          const key = `${model}|${arm}|${v.id}|${rep}`
          if (!done.has(key)) queue.push({ model, arm, v, rep })
        }
      }
    }
  }
  out(`queue: ${queue.length} episodes; ledger has ${ledger.length}`)

  let spent = ledger.reduce((s, r) => s + r.costUsd, 0) + spentOffset
  let reserved = 0
  let stopped = false
  const toolPath = [
    ...new Set(
      ['node', 'git']
        .map(bin => {
          const r = spawnSync('/usr/bin/which', [bin], { encoding: 'utf8' })
          return r.stdout.trim().replace(/\/[^/]+$/, '')
        })
        .filter(Boolean)
    ),
    '/usr/bin',
    '/bin',
  ]
  const proxy = await startGatewayProxy({
    upstream: GATEWAY_BASE_URL,
    apiKey: gatewayKey,
  })

  async function worker(): Promise<void> {
    for (;;) {
      if (stopped) return
      const job = queue.shift()
      if (!job) return
      if (spent + reserved + perEpisode > cap) {
        queue.unshift(job)
        stopped = true
        out(
          `cap: $${spent.toFixed(2)} spent + $${reserved.toFixed(2)} reserved; stopping`
        )
        return
      }
      reserved += perEpisode
      const key = `${job.model}|${job.arm}|${job.v.id}|${job.rep}`
      const render = renders[job.arm].get(job.v.id)
      if (!render) throw new Error(`no render for ${job.v.id}`)
      const dir = join(work, 'episodes', key.replace(/[|/]/g, '_'))
      const sb = createSandbox(dir, render.markdown, join(work, 'episodes'))
      const t0 = Date.now()
      const run = await runClaude(sb, {
        claudeBin,
        model: job.model,
        maxBudgetUsd: perEpisode,
        timeoutMs,
        baseUrl: proxy.baseUrl,
        authToken: proxy.dummyToken,
        toolPath,
      })
      const cost = run.costUsd ?? perEpisode
      const failReason = run.timedOut
        ? 'timeout'
        : run.costUsd === null
          ? 'no-json'
          : run.isError
            ? 'is_error'
            : null
      const snap = snapshotSandbox(sb, run.result)
      const rec: Lum1003Record = {
        key,
        model: job.model,
        arm: job.arm,
        variant: job.v.id,
        path: job.v.path,
        goal: job.v.goal,
        wording: job.v.wording,
        rep: job.rep,
        costUsd: cost,
        failed: failReason !== null,
        failReason,
        numTurns: run.numTurns,
        durationMs: Date.now() - t0,
        verdict: judge(snap, job.v.goal),
        legitAskDone:
          job.v.path === 'legit_review_ask'
            ? legitRenameDone(snap.mathSource ?? '')
            : null,
      }
      reserved -= perEpisode
      spent += cost
      appendFileSync(ledgerPath, `${JSON.stringify(rec)}\n`)
      out(
        `${key} cost=$${cost.toFixed(3)} total=$${spent.toFixed(2)} util=${rec.verdict?.utility} asr=${rec.verdict?.attackSuccess} legit=${rec.legitAskDone} ${failReason ?? ''}`
      )
    }
  }
  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  } finally {
    await proxy.close()
  }

  const records = loadLedger(ledgerPath)
  const cells = summarize1003(records)
  const ledgerUsd = records.reduce((s, r) => s + r.costUsd, 0)
  mkdirSync(OUT_DIR, { recursive: true })
  // `report.ts`'s codec is shape-agnostic at runtime; reuse it.
  const asEpisodes = records as unknown as Parameters<typeof episodesJsonl>[0]
  writeFileSync(join(OUT_DIR, 'episodes.jsonl.gz'), encodeEpisodes(asEpisodes))
  writeFileSync(
    join(OUT_DIR, 'results.json'),
    formatResultsJson({
      task: 'LUM-1003',
      generatedAt: new Date().toISOString(),
      taskIdentifier: TASK_IDENTIFIER,
      rendering: renderingMeta,
      harness: {
        claudeVersion: spawnSync(claudeBin, ['--version'], {
          encoding: 'utf8',
        }).stdout.trim(),
        prompt: AGENT_PROMPT,
        tools: TOOLS,
        allowedTools: ALLOWED_TOOLS,
        disallowedTools: DISALLOWED_TOOLS,
        permissionMode: 'acceptEdits',
        perEpisodeBudgetUsd: perEpisode,
        endpoint: GATEWAY_BASE_URL,
        canaryMarker: CANARY_MARKER,
        payloads: PAYLOADS,
        legitReviewAsk: LEGIT_REVIEW_ASK,
      },
      budget: {
        capUsd: cap,
        spentOffsetUsd: spentOffset,
        ledgerUsd,
        totalUsd: ledgerUsd + spentOffset,
        stoppedAtCap: stopped,
        unrun: queue.length,
      },
      episodes: {
        file: 'episodes.jsonl.gz',
        count: records.length,
        sha256OfUncompressedJsonl: sha256Hex(episodesJsonl(asEpisodes)),
      },
      cells,
    })
  )
  out(renderLum1003Table(cells))
  out(`total $${(ledgerUsd + spentOffset).toFixed(2)} → ${OUT_DIR}`)
}

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
