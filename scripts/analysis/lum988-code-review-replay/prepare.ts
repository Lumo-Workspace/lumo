/**
 * LUM-988 — fetch what the AI review sees for every PR of the Martian Code
 * Review Bench offline set: the unified diff, and the PR-head content of
 * every file the PR changed (not removed). Production reads the same two
 * things from GitHub (`fetchPrDiff`, `readRepoFile` at the head sha).
 *
 *   npx tsx scripts/analysis/lum988-code-review-replay/prepare.ts \
 *     --bench <code-review-benchmark>/offline --out <data dir>
 *
 * Writes `<out>/prs.json` and, per PR, `<out>/<key>/diff.patch` plus
 * `<out>/<key>/files/<path>`. Re-running skips what is already on disk.
 * Needs a logged-in `gh`. Files over 200 KB are not fetched: the shipped
 * packer never includes them (REVIEW_CONTEXT_MAX_FILE_CHARS).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { prKey } from './pr-key'

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`--${name} is required`)
  return v
}

function gh(args: string[], accept?: string): Buffer {
  return execFileSync(
    'gh',
    ['api', ...(accept ? ['-H', `Accept: ${accept}`] : []), ...args],
    { maxBuffer: 256 * 1024 * 1024 }
  )
}

const bench = arg('bench')
const out = arg('out')
const prs = Object.keys(
  JSON.parse(
    readFileSync(path.join(bench, 'results/benchmark_data.json'), 'utf8')
  ) as Record<string, unknown>
).sort()
mkdirSync(out, { recursive: true })
writeFileSync(path.join(out, 'prs.json'), JSON.stringify(prs, null, 1))

for (const url of prs) {
  const [owner, repo, , num] = url.split('github.com/')[1]!.split('/')
  const dir = path.join(out, prKey(url))
  mkdirSync(path.join(dir, 'files'), { recursive: true })
  const diffPath = path.join(dir, 'diff.patch')
  if (!existsSync(diffPath))
    writeFileSync(
      diffPath,
      gh([`repos/${owner}/${repo}/pulls/${num}`], 'application/vnd.github.diff')
    )
  const head = (
    JSON.parse(gh([`repos/${owner}/${repo}/pulls/${num}`]).toString()) as {
      head: { sha: string }
    }
  ).head.sha
  const files = JSON.parse(
    gh([
      '--paginate',
      '--slurp',
      `repos/${owner}/${repo}/pulls/${num}/files?per_page=100`,
    ]).toString()
  ) as Array<Array<{ filename: string; status: string }>>
  let fetched = 0
  for (const f of files.flat()) {
    if (f.status === 'removed') continue
    const dest = path.join(dir, 'files', f.filename)
    if (existsSync(dest)) {
      fetched++
      continue
    }
    let body: Buffer
    try {
      body = gh(
        [`repos/${owner}/${repo}/contents/${f.filename}?ref=${head}`],
        'application/vnd.github.raw'
      )
    } catch {
      continue
    }
    if (body.length > 200_000) continue
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, body)
    fetched++
  }
  process.stdout.write(
    `${url.split('github.com/')[1]} files=${files.flat().length} fetched=${fetched}\n`
  )
}
