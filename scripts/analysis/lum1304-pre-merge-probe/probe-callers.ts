/**
 * LUM-1304 — replay two other DeepSeek V4-Pro structured callers through
 * their shipped code, one call at a time, to check the structured-output
 * routing outside the pre-merge checks:
 *
 *   fold       `computeProjectFoldProposals` (clustering → synthesis →
 *              coverage) over real team memory cards
 *              (`__tests__/memory/fixtures/team-memory-corpus.json`), with the
 *              memory repository stubbed: no database is read or written.
 *              Identical vectors make every cluster pass the coherence guard,
 *              so synthesis and coverage run too.
 *   summary    `summarizeWholePr` on a real PR's file list and diff (`gh`).
 *
 *   DOTENV_CONFIG_PATH=/abs/main-checkout/.env.local \
 *     npx tsx -r dotenv/config scripts/analysis/lum1304-pre-merge-probe/probe-callers.ts \
 *     --caller fold|summary --n 3 [--cards 40] [--repo Lumo-Workspace/lumo --pr 1685]
 *
 * Prints one JSON line per run and a summary; never prints prompt text.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`missing --${name}`)
  return v
}

async function foldOnce(cards: number): Promise<Record<string, unknown>> {
  const corpus = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../__tests__/memory/fixtures/team-memory-corpus.json'
      ),
      'utf8'
    )
  ) as Array<{ id: string; text: string }>
  const picked = corpus.slice(0, cards)
  const { memoryRepository } =
    await import('@/lib/repositories/memory.repository')
  memoryRepository.findActiveProjectMemories = (async () =>
    picked.map(c => ({
      id: c.id,
      category: 'TRAP',
      content: { summary: c.text },
    }))) as never
  memoryRepository.findActiveProjectMemoryVectors = (async () =>
    picked.map(c => ({ id: c.id, vector: [1, 0, 0, 0] }))) as never
  const { computeProjectFoldProposals } =
    await import('@/lib/services/memory/fold-compute')
  const { proposals, degraded } = await computeProjectFoldProposals(
    'lum1304-probe',
    { maxProposals: 2 }
  )
  return { ok: !degraded, degraded, proposals: proposals.length }
}

async function summaryOnce(
  repo: string,
  pr: number
): Promise<Record<string, unknown>> {
  const files = (
    JSON.parse(
      execFileSync(
        'gh',
        ['pr', 'view', String(pr), '--repo', repo, '--json', 'files'],
        { encoding: 'utf8' }
      )
    ) as {
      files: Array<{ path: string; additions: number; deletions: number }>
    }
  ).files
  const diff = execFileSync('gh', ['pr', 'diff', String(pr), '--repo', repo], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const { summarizeWholePr } =
    await import('@/ee/security/llm/pr-summary-client')
  const out = await summarizeWholePr({
    files,
    diff: { text: diff.slice(0, 40_000), notices: [] },
    diffTruncated: diff.length > 40_000,
    previous: null,
    tone: '',
  })
  return {
    ok: out.intent.length > 0,
    intentChars: out.intent.length,
    changes: out.changes.length,
  }
}

async function main() {
  const caller = arg('caller')
  const n = Number(arg('n', '3'))
  const rows: Array<{ ok: boolean; ms: number }> = []
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    let row: Record<string, unknown>
    try {
      row =
        caller === 'fold'
          ? await foldOnce(Number(arg('cards', '40')))
          : await summaryOnce(
              arg('repo', 'Lumo-Workspace/lumo'),
              Number(arg('pr', '1685'))
            )
    } catch (error) {
      row = {
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 160) : 'error',
      }
    }
    const rec = { i, ms: Date.now() - t0, ...row } as {
      ok: boolean
      ms: number
    }
    rows.push(rec)
    process.stdout.write(`${JSON.stringify(rec)}\n`)
  }
  const ms = rows.map(r => r.ms).sort((a, b) => a - b)
  process.stdout.write(
    `${JSON.stringify({ caller, n, ok: rows.filter(r => r.ok).length, p50ms: ms[Math.floor(n / 2)], maxms: ms[n - 1] })}\n`
  )
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exitCode = 1
})
