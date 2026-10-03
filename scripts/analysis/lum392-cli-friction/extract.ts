/**
 * LUM-392: extract every lumo CLI invocation from prod HookEvent history
 * (read-only) and aggregate friction stats: per-command frequency, error
 * rate, output size (context cost), retry chains, never-used commands,
 * unknown/hallucinated command paths.
 *
 * Run:    npx tsx scripts/analysis/lum392-cli-friction/extract.ts
 * Check:  npx tsx scripts/analysis/lum392-cli-friction/extract.ts --check
 *
 * Loads .env.production by default (pre-set DATABASE_URL wins — dotenv
 * never overrides). Only SELECTs are issued.
 *
 * Outputs (gitignored):
 *   scripts/analysis/lum392-cli-friction/out/invocations.jsonl
 *   scripts/analysis/lum392-cli-friction/out/stats.json
 */
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  KNOWN_COMMAND_PATHS,
  classifyOutput,
  extractLumoSegments,
  firstPositionalArg,
  parseInvocation,
} from './parse'

config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.production' })

const RETRY_WINDOW_MS = 10 * 60 * 1000

interface InvocationRecord {
  eventId: string
  sessionId: string | null
  taskId: string | null
  createdAt: string
  commandPath: string
  known: boolean
  flags: string[]
  /** First positional arg (usually the LUM-N / doc id the command targets). */
  target: string | null
  raw: string
  /** >1 lumo invocation in the same Bash call → output attribution ambiguous */
  siblings: number
  errored: boolean
  errorKind: string | null
  evidence: string | null
  stdoutChars: number
  durationMs: number | null
}

async function main() {
  const check = process.argv.includes('--check')
  const { prisma } = await import('@/lib/db/prisma')
  const { openHookPayloads } = await import('@/lib/hook-event/payload-cipher')

  // ---- fetch all Bash POST_TOOL_USE events that mention lumo (keyset) ----
  // LUM-863: payloads may be encrypted, so the `lumo` match runs in JS after
  // decryption instead of as a JSON-path filter in SQL.
  type Row = {
    id: string
    sessionId: string | null
    taskId: string | null
    createdAt: Date
    payload: any
  }
  const rows: Row[] = []
  let cursor: string | null = null
  for (;;) {
    const batch = await prisma.hookEvent.findMany({
      where: { type: 'POST_TOOL_USE', toolName: 'Bash' },
      select: {
        id: true,
        sessionId: true,
        taskId: true,
        createdAt: true,
        payload: true,
        workspaceId: true,
        payloadEncrypted: true,
      },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    for (const row of (await openHookPayloads(batch)) as Row[]) {
      const command = row.payload?.tool_input?.command
      if (typeof command === 'string' && command.includes('lumo')) {
        rows.push(row)
      }
    }
    if (batch.length < 500) break
    cursor = batch[batch.length - 1]!.id
  }

  const totalSessions = await prisma.session.count()

  // ---- parse into invocation records ----
  const records: InvocationRecord[] = []
  for (const row of rows) {
    const command = String(row.payload?.tool_input?.command ?? '')
    const segments = extractLumoSegments(command)
    if (segments.length === 0) continue // path/word noise, not an invocation
    const tr = row.payload?.tool_response ?? {}
    const out = classifyOutput({
      stdout: String(tr.stdout ?? ''),
      stderr: String(tr.stderr ?? ''),
      interrupted: Boolean(tr.interrupted),
    })
    for (const seg of segments) {
      const inv = parseInvocation(seg)
      records.push({
        eventId: row.id,
        sessionId: row.sessionId,
        taskId: row.taskId,
        createdAt: row.createdAt.toISOString(),
        commandPath: inv.commandPath,
        known: inv.known,
        flags: inv.flags,
        target: firstPositionalArg(inv),
        // 2000 keeps most quoted bodies whole; truncated raws are excluded
        // from AST validation downstream (an open quote leaks fake flags).
        raw: inv.raw.slice(0, 2000),
        siblings: segments.length,
        errored: out.errored,
        errorKind: out.errorKind,
        evidence: out.evidence,
        stdoutChars: String(tr.stdout ?? '').length,
        durationMs:
          typeof row.payload?.duration_ms === 'number'
            ? row.payload.duration_ms
            : null,
      })
    }
  }

  // ---- aggregate ----
  const byCommand = new Map<
    string,
    {
      count: number
      errors: number
      stdoutChars: number[]
      flags: Map<string, number>
    }
  >()
  for (const r of records) {
    const agg = byCommand.get(r.commandPath) ?? {
      count: 0,
      errors: 0,
      stdoutChars: [],
      flags: new Map<string, number>(),
    }
    agg.count++
    if (r.errored) agg.errors++
    agg.stdoutChars.push(r.stdoutChars)
    for (const f of r.flags) agg.flags.set(f, (agg.flags.get(f) ?? 0) + 1)
    byCommand.set(r.commandPath, agg)
  }

  const usedKnown = new Set(
    records.filter(r => r.known).map(r => r.commandPath)
  )
  const neverUsed = KNOWN_COMMAND_PATHS.filter(p => !usedKnown.has(p))

  // retry chains: same session + same commandPath, consecutive within window
  const bySession = new Map<string, InvocationRecord[]>()
  for (const r of records) {
    if (!r.sessionId) continue
    const list = bySession.get(r.sessionId) ?? []
    list.push(r)
    bySession.set(r.sessionId, list)
  }
  interface RetryChain {
    sessionId: string
    commandPath: string
    length: number
    firstErrored: boolean
    anyErrored: boolean
    start: string
    raws: string[]
  }
  const chains: RetryChain[] = []
  for (const [sessionId, list] of bySession) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    let i = 0
    while (i < list.length) {
      let j = i
      while (
        j + 1 < list.length &&
        list[j + 1]!.commandPath === list[i]!.commandPath &&
        (list[j + 1]!.target ?? '') === (list[i]!.target ?? '') && // same target only
        list[j + 1]!.eventId !== list[j]!.eventId && // distinct Bash calls only
        new Date(list[j + 1]!.createdAt).getTime() -
          new Date(list[j]!.createdAt).getTime() <
          RETRY_WINDOW_MS
      ) {
        j++
      }
      if (j > i) {
        const span = list.slice(i, j + 1)
        chains.push({
          sessionId,
          commandPath: list[i]!.commandPath,
          length: span.length,
          firstErrored: span[0]!.errored,
          anyErrored: span.some(r => r.errored),
          start: span[0]!.createdAt,
          raws: span.map(r => r.raw),
        })
      }
      i = j + 1
    }
  }

  const pct = (n: number, d: number) =>
    d === 0 ? 0 : Math.round((n / d) * 1000) / 10
  const p = (arr: number[], q: number) => {
    if (arr.length === 0) return 0
    const sorted = [...arr].sort((a, b) => a - b)
    return (
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
    )
  }

  const commandStats = [...byCommand.entries()]
    .map(([path, a]) => ({
      commandPath: path,
      count: a.count,
      errors: a.errors,
      errorRatePct: pct(a.errors, a.count),
      stdoutCharsMedian: p(a.stdoutChars, 0.5),
      stdoutCharsP90: p(a.stdoutChars, 0.9),
      stdoutCharsTotal: a.stdoutChars.reduce((s, n) => s + n, 0),
      topFlags: [...a.flags.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8),
    }))
    .sort((x, y) => y.count - x.count)

  const stats = {
    generatedFor: 'LUM-392',
    coverage: {
      bashEventsWithLumo: rows.length,
      invocations: records.length,
      distinctSessions: new Set(records.map(r => r.sessionId).filter(Boolean))
        .size,
      totalSessionsInDb: totalSessions,
      timeRange: records.length
        ? {
            from: records.reduce(
              (m, r) => (r.createdAt < m ? r.createdAt : m),
              records[0]!.createdAt
            ),
            to: records.reduce(
              (m, r) => (r.createdAt > m ? r.createdAt : m),
              records[0]!.createdAt
            ),
          }
        : null,
    },
    errors: {
      total: records.filter(r => r.errored).length,
      byKind: Object.fromEntries(
        [
          ...new Set(
            records.filter(r => r.errored).map(r => String(r.errorKind))
          ),
        ].map(k => [k, records.filter(r => r.errorKind === k).length])
      ),
    },
    commandStats,
    unknownCommands: commandStats.filter(c =>
      c.commandPath.startsWith('unknown:')
    ),
    neverUsedKnownCommands: neverUsed,
    retryChains: {
      total: chains.length,
      withErrorInChain: chains.filter(c => c.anyErrored).length,
      byCommand: Object.fromEntries(
        [...new Set(chains.map(c => c.commandPath))]
          .map(
            p => [p, chains.filter(c => c.commandPath === p).length] as const
          )
          .sort((a, b) => b[1] - a[1])
      ),
      longest: chains
        .sort((a, b) => b.length - a.length)
        .slice(0, 15)
        .map(({ raws: _raws, ...rest }) => rest),
    },
  }

  // ---- write outputs ----
  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, 'invocations.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  )
  writeFileSync(join(outDir, 'chains.json'), JSON.stringify(chains, null, 2))
  writeFileSync(join(outDir, 'stats.json'), JSON.stringify(stats, null, 2))

  // ---- report / check ----
  console.log(
    `Scanned ${rows.length} Bash events → ${records.length} lumo invocations`
  )
  console.log(
    `Sessions covered: ${stats.coverage.distinctSessions}/${totalSessions}, range ${stats.coverage.timeRange?.from} → ${stats.coverage.timeRange?.to}`
  )
  console.log(
    `Errors: ${stats.errors.total} (${JSON.stringify(stats.errors.byKind)})`
  )
  console.log(
    `Distinct commands used: ${usedKnown.size}/${KNOWN_COMMAND_PATHS.length}`
  )
  console.log(`Never used: ${neverUsed.length} commands`)
  console.log(
    `Retry chains: ${chains.length} (${stats.retryChains.withErrorInChain} contain an error)`
  )
  console.log(`Top 10 commands:`)
  for (const c of commandStats.slice(0, 10)) {
    console.log(
      `  ${c.commandPath.padEnd(24)} n=${String(c.count).padStart(4)}  err=${String(c.errors).padStart(3)} (${c.errorRatePct}%)  stdout p50/p90=${c.stdoutCharsMedian}/${c.stdoutCharsP90}`
    )
  }

  if (check) {
    const ok =
      records.length > 0 &&
      stats.coverage.distinctSessions > 0 &&
      commandStats.length > 0
    console.log(check && ok ? 'CHECK PASS' : 'CHECK FAIL')
    if (!ok) process.exitCode = 1
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
