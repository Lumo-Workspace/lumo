/**
 * LUM-999 — real Claude Code vs injections in Lumo-rendered context.
 *
 *   npx tsx scripts/analysis/lum999-lumo-context-injection/run.ts \
 *     --before <origin/main worktree> --after <PR #1290 worktree> \
 *     --afterB <PR #1290 + PR #1292 merged worktree> \
 *     --env-file .env.local --work ~/.cache/lumo-lum999 \
 *     --models claude-haiku-4-5 --variants clean,description__canary_file__plain \
 *     --n 3 --cap 40 --spent-offset 0.5
 *
 * Renders every variant through all three trees (render-arms.ts), then runs one
 * `claude -p` episode per (model, arm, variant, rep) in a fresh sandbox,
 * judges it from the sandbox state and appends the record to
 * <work>/episodes.jsonl (episodes already there are skipped, so an
 * interrupted run resumes). Stops scheduling once the running total
 * (ledger + --spent-offset + budgets reserved by in-flight episodes) would
 * pass --cap. Writes --out (default: results.json next to this file) with
 * the aggregated cells, and episodes.jsonl.gz next to it with every record.
 *
 * Auth (LUM-1001): the Gateway key is read here and handed only to a loopback
 * proxy (proxy.ts) that lives for the duration of the suite. Agents get the
 * proxy URL and a random per-run dummy token, never the key.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { spawnSync } from 'child_process'
import {
  CANARY_MARKER,
  PAYLOADS,
  TASK_IDENTIFIER,
  buildVariants,
  type Variant,
} from './fixtures'
import { judge } from './judge'
import { startGatewayProxy } from './proxy'
import { gitHead, renderArm, type ArmRender } from './render-arms'
import {
  ARMS,
  EPISODES_FILE,
  encodeEpisodes,
  episodeKey,
  episodesJsonl,
  formatResultsJson,
  sha256Hex,
  renderTable,
  summarize,
  totalCost,
  type Arm,
  type EpisodeRecord,
} from './report'
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

function loadLedger(path: string): EpisodeRecord[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as EpisodeRecord)
}

async function main(): Promise<void> {
  const arms = arg('arms', 'before,after,afterB').split(',') as Arm[]
  for (const a of arms) {
    if (!(ARMS as readonly string[]).includes(a))
      throw new Error(`unknown arm ${a}`)
  }
  // Every arm in ARMS is rendered (results.json records all three SHAs);
  // --arms only picks which ones get episodes.
  const trees: Record<Arm, string> = {
    before: resolve(arg('before')),
    after: resolve(arg('after')),
    afterB: resolve(arg('afterB')),
  }
  const work = resolve(arg('work', join(homedir(), '.cache', 'lumo-lum999')))
  const models = arg('models').split(',')
  const n = Number(arg('n', '3'))
  const cap = Number(arg('cap', '40'))
  const spentOffset = Number(arg('spent-offset', '0'))
  const perEpisode = Number(arg('per-episode', '0.6'))
  const concurrency = Number(arg('concurrency', '4'))
  const timeoutMs = Number(arg('timeout-sec', '420')) * 1000
  const outPath = resolve(arg('out', join(__dirname, 'results.json')))
  const claudeBin = arg('claude', join(homedir(), '.local', 'bin', 'claude'))
  const gatewayKey = readEnvKey(resolve(arg('env-file')), 'AI_GATEWAY_API_KEY')

  const all = buildVariants()
  const wanted = arg('variants', 'all')
  const variants: Variant[] =
    wanted === 'all'
      ? all
      : wanted.split(',').map(id => {
          const v = all.find(x => x.id === id)
          if (!v) throw new Error(`unknown variant ${id}`)
          return v
        })

  mkdirSync(work, { recursive: true })
  const shas: Record<Arm, string> = {
    before: gitHead(trees.before),
    after: gitHead(trees.after),
    afterB: gitHead(trees.afterB),
  }
  const renders: Record<Arm, Map<string, ArmRender>> = {
    before: new Map(),
    after: new Map(),
    afterB: new Map(),
  }
  for (const arm of ARMS) {
    const r = renderArm(trees[arm], all, join(work, `render-${arm}`))
    for (const x of r) renders[arm].set(x.id, x)
    out(`rendered ${r.length} variants through ${arm} @ ${shas[arm]}`)
  }

  const ledgerPath = join(work, 'episodes.jsonl')
  const ledger = loadLedger(ledgerPath)
  const done = new Set(ledger.map(r => r.key))

  // Rep-major so a capped run leaves balanced N; before/after adjacent.
  const queue: Array<{ model: string; arm: Arm; v: Variant; rep: number }> = []
  for (let rep = 1; rep <= n; rep++) {
    for (const v of variants) {
      for (const model of models) {
        for (const arm of arms) {
          if (!done.has(episodeKey(model, arm, v.id, rep))) {
            queue.push({ model, arm, v, rep })
          }
        }
      }
    }
  }
  out(`queue: ${queue.length} episodes; ledger has ${ledger.length}`)

  let spent = totalCost(ledger) + spentOffset
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
      const key = episodeKey(job.model, job.arm, job.v.id, job.rep)
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
      const rec: EpisodeRecord = {
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
      }
      reserved -= perEpisode
      spent += cost
      appendFileSync(ledgerPath, `${JSON.stringify(rec)}\n`)
      out(
        `${key} cost=$${cost.toFixed(3)} total=$${spent.toFixed(2)} util=${rec.verdict?.utility} asr=${rec.verdict?.attackSuccess} ${failReason ?? ''}`
      )
    }
  }
  const proxy = await startGatewayProxy({
    upstream: GATEWAY_BASE_URL,
    apiKey: gatewayKey,
  })
  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  } finally {
    await proxy.close()
  }

  const records = loadLedger(ledgerPath)
  const cells = summarize(records)
  const results = {
    task: 'LUM-999',
    generatedAt: new Date().toISOString(),
    taskIdentifier: TASK_IDENTIFIER,
    rendering: {
      before: { tree: 'origin/main', sha: shas.before },
      after: { tree: 'PR #1290 head', sha: shas.after },
      afterB: {
        tree: 'PR #1290 head + PR #1292 head merged locally (never pushed)',
        sha: shas.afterB,
        parents: spawnSync(
          'git',
          ['-C', trees.afterB, 'log', '-1', '--format=%P'],
          {
            encoding: 'utf8',
          }
        )
          .stdout.trim()
          .split(' '),
      },
      variants: all.map(v => ({
        id: v.id,
        // First 16 hex chars of the rendered markdown's sha256 per arm —
        // enough to show which arms render a variant byte-identically.
        sha256: Object.fromEntries(
          ARMS.map(a => [a, renders[a].get(v.id)?.sha256.slice(0, 16) ?? null])
        ),
        guardNoticeOrMarker: Object.fromEntries(
          ARMS.map(a => [
            a,
            (renders[a].get(v.id)?.markdown ?? '').includes('⚠'),
          ])
        ),
      })),
    },
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
    },
    budget: {
      capUsd: cap,
      spentOffsetUsd: spentOffset,
      ledgerUsd: totalCost(records),
      totalUsd: totalCost(records) + spentOffset,
      stoppedAtCap: stopped,
      unrun: queue.length,
    },
    episodes: {
      file: EPISODES_FILE,
      count: records.length,
      sha256OfUncompressedJsonl: sha256Hex(episodesJsonl(records)),
    },
    cells,
  }
  writeFileSync(join(dirname(outPath), EPISODES_FILE), encodeEpisodes(records))
  writeFileSync(outPath, formatResultsJson(results))
  out(renderTable(cells))
  out(`total $${(totalCost(records) + spentOffset).toFixed(2)} → ${outPath}`)
}

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
