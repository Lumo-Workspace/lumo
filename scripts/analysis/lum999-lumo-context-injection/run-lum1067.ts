/**
 * LUM-1067 — re-run the session-summary cells of the LUM-999 harness, plus a
 * legit carry-over utility variant, on any number of named arms.
 *
 *   npx tsx scripts/analysis/lum999-lumo-context-injection/run-lum1067.ts \
 *     --arm before=<origin/main worktree> --arm after=<PR head worktree> \
 *     --env-file .env.local --work ~/.cache/lumo-lum1067 \
 *     --variants all-attacked --n 8 \
 *     --cap 5 --spent-offset <pilot $> --per-episode 0.15 --concurrency 4
 *
 * An arm is either a git worktree (every variant is rendered through that
 * tree's real service + CLI renderer, as in run.ts) or, for the pilot, a
 * directory of hand-built candidate renders `<variant id>.md`.
 *
 * Same sandbox, judge, loopback proxy and budget accounting as
 * run-lum1003.ts. Only a run whose arms are exactly `before` + `after`
 * writes results (`--out-dir`, default results-lum1067/); a pilot only
 * appends to its ledger and prints per-arm counts.
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
  LEGIT_CARRY_OVER,
  buildLum1067Variants,
  type Lum1067Variant,
} from './fixtures-lum1067'
import { judge, legitNegativeCaseDone } from './judge'
import { startGatewayProxy } from './proxy'
import { gitHead, renderArm, sha256, type ArmRender } from './render-arms'
import {
  encodeEpisodes,
  episodesJsonl,
  formatResultsJson,
  sha256Hex,
} from './report'
import {
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

/** Every `--arm name=path`, in order. */
function armArgs(): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  process.argv.forEach((a, i) => {
    if (a !== '--arm') return
    const v = process.argv[i + 1] ?? ''
    const eq = v.indexOf('=')
    if (eq <= 0) throw new Error(`--arm wants name=path, got ${v}`)
    out.push({ name: v.slice(0, eq), path: resolve(v.slice(eq + 1)) })
  })
  if (out.length === 0) throw new Error('at least one --arm name=path')
  return out
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

/** A git worktree renders through its code; anything else is a dir of .md. */
function isTree(path: string): boolean {
  return existsSync(join(path, '.git'))
}

async function main(): Promise<void> {
  const arms = armArgs()
  const work = resolve(arg('work', join(homedir(), '.cache', 'lumo-lum1067')))
  const model = arg('model', 'claude-haiku-4-5')
  const n = Number(arg('n', '8'))
  const cap = Number(arg('cap', '5'))
  const spentOffset = Number(arg('spent-offset', '0'))
  const perEpisode = Number(arg('per-episode', '0.15'))
  const concurrency = Number(arg('concurrency', '4'))
  const timeoutMs = Number(arg('timeout-sec', '420')) * 1000
  const claudeBin = arg('claude', join(homedir(), '.local', 'bin', 'claude'))
  const renderOnly = process.argv.includes('--render-only')
  const OUT_DIR = resolve(arg('out-dir', join(__dirname, 'results-lum1067')))

  const all = buildLum1067Variants()
  const wanted = arg('variants', 'all-attacked')
  const variants: Lum1067Variant[] =
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
  const renders = new Map<string, Map<string, ArmRender>>()
  const armMeta: Record<string, { source: string; sha: string | null }> = {}
  for (const a of arms) {
    const m = new Map<string, ArmRender>()
    if (isTree(a.path)) {
      for (const r of renderArm(a.path, all, join(work, `render-${a.name}`)))
        m.set(r.id, r)
      armMeta[a.name] = { source: 'git worktree', sha: gitHead(a.path) }
    } else {
      for (const v of variants) {
        const file = join(a.path, `${v.id}.md`)
        if (!existsSync(file)) continue
        const markdown = readFileSync(file, 'utf8')
        m.set(v.id, { id: v.id, markdown, sha256: sha256(markdown) })
      }
      armMeta[a.name] = { source: 'hand-built candidate renders', sha: null }
    }
    renders.set(a.name, m)
    out(`arm ${a.name}: ${m.size} renders (${armMeta[a.name]?.source})`)
  }
  const renderingMeta = {
    arms: armMeta,
    variants: all.map(v => ({
      id: v.id,
      sha256: Object.fromEntries(
        arms.map(a => [
          a.name,
          renders.get(a.name)?.get(v.id)?.sha256.slice(0, 16) ?? null,
        ])
      ),
    })),
  }
  if (renderOnly) {
    for (const a of arms) {
      const dir = join(work, `render-${a.name}`)
      mkdirSync(dir, { recursive: true })
      for (const [id, r] of renders.get(a.name) ?? []) {
        writeFileSync(join(dir, `${id}.md`), r.markdown)
      }
    }
    out(JSON.stringify(renderingMeta, null, 2))
    return
  }

  const gatewayKey = readEnvKey(resolve(arg('env-file')), 'AI_GATEWAY_API_KEY')
  const ledgerPath = join(work, 'episodes.jsonl')
  const ledger = loadLedger(ledgerPath)
  const done = new Set(ledger.map(r => r.key))

  const queue: Array<{ arm: string; v: Lum1067Variant; rep: number }> = []
  for (let rep = 1; rep <= n; rep++) {
    for (const v of variants) {
      for (const a of arms) {
        if (!renders.get(a.name)?.has(v.id)) continue
        const key = `${model}|${a.name}|${v.id}|${rep}`
        if (!done.has(key)) queue.push({ arm: a.name, v, rep })
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
      const key = `${model}|${job.arm}|${job.v.id}|${job.rep}`
      const render = renders.get(job.arm)?.get(job.v.id)
      if (!render) throw new Error(`no render for ${job.arm}/${job.v.id}`)
      const dir = join(work, 'episodes', key.replace(/[|/]/g, '_'))
      const sb = createSandbox(dir, render.markdown, join(work, 'episodes'))
      const t0 = Date.now()
      const run = await runClaude(sb, {
        claudeBin,
        model,
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
        model,
        arm: job.arm as Lum1003Arm,
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
          job.v.path === 'legit_carry_over'
            ? legitNegativeCaseDone(snap.testSource ?? '')
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
  for (const c of cells) {
    out(
      `${c.arm}\t${c.variant}\tn=${c.n}\tfailed=${c.failed}\tasr=${c.attackSuccesses ?? '-'}\tlegit=${c.legitAskDone ?? '-'}\tutil=${c.utility}\t$${c.costUsd.toFixed(2)}`
    )
  }
  out(`ledger $${ledgerUsd.toFixed(2)} + offset $${spentOffset.toFixed(2)}`)
  const names = arms.map(a => a.name).sort()
  if (names.join(',') !== 'after,before') {
    out('pilot run (arms are not exactly before/after): no results written')
    return
  }

  mkdirSync(OUT_DIR, { recursive: true })
  // `report.ts`'s codec is shape-agnostic at runtime; reuse it.
  const asEpisodes = records as unknown as Parameters<typeof episodesJsonl>[0]
  writeFileSync(join(OUT_DIR, 'episodes.jsonl.gz'), encodeEpisodes(asEpisodes))
  writeFileSync(
    join(OUT_DIR, 'results.json'),
    formatResultsJson({
      task: 'LUM-1067',
      generatedAt: new Date().toISOString(),
      taskIdentifier: TASK_IDENTIFIER,
      rendering: renderingMeta,
      harness: {
        claudeVersion: spawnSync(claudeBin, ['--version'], {
          encoding: 'utf8',
        }).stdout.trim(),
        model,
        prompt: AGENT_PROMPT,
        tools: TOOLS,
        allowedTools: ALLOWED_TOOLS,
        disallowedTools: DISALLOWED_TOOLS,
        permissionMode: 'acceptEdits',
        perEpisodeBudgetUsd: perEpisode,
        endpoint: GATEWAY_BASE_URL,
        canaryMarker: CANARY_MARKER,
        payloads: PAYLOADS,
        legitCarryOver: LEGIT_CARRY_OVER,
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
