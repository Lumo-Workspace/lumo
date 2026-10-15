/**
 * LUM-1158 — fetch what every manifest PR needs, into a scratch data dir in
 * the LUM-988 replay layout (so `replay.ts` / `verify.ts` / `rank.ts` run on
 * it unchanged), plus the benchmark's own inputs:
 *
 *   <data>/prs.json                  PR urls (the replay scripts' input)
 *   <data>/meta.json                 url → { id, source }
 *   <data>/<prKey>/diff.patch        base...hashX — what the reviewers saw
 *   <data>/<prKey>/files/<path>      each changed file at hashX (≤ 200 KB)
 *   <data>/<prKey>/post.json         title + post-review commits (message, diff)
 *   <data>/<prKey>/reference.json    bot-a's review of hashX (oss rows only)
 *   <checkouts>/co/<prKey>           detached checkout at hashX (verifier shell)
 *
 * PR content stays in the scratch dir: never commit it.
 *
 *   BENCH_REFERENCE_LOGIN='<app>[bot]' npx tsx \
 *     scripts/analysis/lum1158-review-quality-bench/collect.ts \
 *     --data <dir> --checkouts <dir> [--manifest <file>] [--ids oss-01,own-02]
 *
 * Re-running skips files that exist.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  lstatSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { prKey } from '../lum988-code-review-replay/pr-key'
import {
  changedPaths,
  insideDir,
  commitsAfter,
  referenceReviewAt,
  type GhCommit,
  type GhReview,
  type GhReviewComment,
  type Manifest,
} from './bench-lib'
import { checkoutAt, ghDiff, ghJson, ghList } from './github'

/** REVIEW_CONTEXT_MAX_FILE_CHARS: the packer never includes bigger files. */
const MAX_FILE_BYTES = 200_000
/** Post-review diff budget: per commit and per PR, for the truth step. */
const COMMIT_DIFF_MAX_CHARS = 30_000
const POST_DIFF_MAX_CHARS = 90_000

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}

const dataDir = opt('data')
const checkouts = opt('checkouts')
const manifestFile = opt('manifest', path.join(__dirname, 'manifest.json'))
const only = new Set(opt('ids', '').split(',').filter(Boolean))
const referenceLogin = process.env.BENCH_REFERENCE_LOGIN ?? ''

const log = (s: string) => process.stdout.write(`${s}\n`)
const clip = (s: string, max: number) =>
  s.length > max
    ? `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]`
    : s

function main(): void {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
  const rows = manifest.prs.filter(p => only.size === 0 || only.has(p.id))
  if (rows.some(p => p.source === 'oss') && !referenceLogin)
    throw new Error('BENCH_REFERENCE_LOGIN is required for oss rows')
  mkdirSync(dataDir, { recursive: true })
  // A partial run (--ids) adds to what earlier runs collected, never drops it.
  const metaFile = path.join(dataDir, 'meta.json')
  const meta: Record<string, { id: string; source: string }> = existsSync(
    metaFile
  )
    ? JSON.parse(readFileSync(metaFile, 'utf8'))
    : {}
  for (const p of rows) {
    const key = prKey(p.url)
    const dir = path.join(dataDir, key)
    try {
      mkdirSync(path.join(dir, 'files'), { recursive: true })
      const diffFile = path.join(dir, 'diff.patch')
      if (!existsSync(diffFile))
        writeFileSync(
          diffFile,
          ghDiff(`repos/${p.repo}/compare/${p.base}...${p.hashX}`)
        )
      const co = checkoutAt(checkouts, p.repo, p.hashX, key)
      // From the diff, not the compare JSON: that one lists at most 300 files.
      for (const f of changedPaths(readFileSync(diffFile, 'utf8'))) {
        const src = path.resolve(co, f)
        const dest = path.resolve(dir, 'files', f)
        // Third-party checkout: never follow a symlink or a path out of it.
        if (!insideDir(co, src) || !insideDir(path.join(dir, 'files'), dest))
          continue
        if (existsSync(dest) || !existsSync(src)) continue
        const st = lstatSync(src)
        if (!st.isFile() || st.size > MAX_FILE_BYTES) continue
        // A symlinked parent directory could still lead outside the checkout.
        if (!insideDir(realpathSync(co), realpathSync(src))) continue
        mkdirSync(path.dirname(dest), { recursive: true })
        writeFileSync(dest, readFileSync(src))
      }
      const postFile = path.join(dir, 'post.json')
      if (!existsSync(postFile)) {
        const pr = ghJson<{ title: string }>(
          `repos/${p.repo}/pulls/${p.number}`
        )
        const commits = ghList<GhCommit & { commit: { message: string } }>(
          `repos/${p.repo}/pulls/${p.number}/commits`
        )
        const after = commitsAfter(commits, p.hashX)
        // Hash X force-pushed away: no ground truth — skip, never cache empty.
        if (!after) throw new Error('hash X is no longer in the PR history')
        let budget = POST_DIFF_MAX_CHARS
        const post = after.map(c => {
          const diff = clip(
            ghDiff(`repos/${p.repo}/commits/${c.sha}`),
            Math.max(0, Math.min(COMMIT_DIFF_MAX_CHARS, budget))
          )
          budget -= diff.length
          const full = commits.find(x => x.sha === c.sha)
          return { sha: c.sha, message: full?.commit.message ?? '', diff }
        })
        writeFileSync(
          postFile,
          JSON.stringify({ title: pr.title, commits: post }, null, 1)
        )
      }
      const refFile = path.join(dir, 'reference.json')
      if (p.source === 'oss' && !existsSync(refFile)) {
        const reviews = ghList<GhReview>(
          `repos/${p.repo}/pulls/${p.number}/reviews`
        )
        const comments = ghList<GhReviewComment>(
          `repos/${p.repo}/pulls/${p.number}/comments`
        )
        writeFileSync(
          refFile,
          JSON.stringify(
            referenceReviewAt(reviews, comments, referenceLogin, p.hashX),
            null,
            1
          )
        )
      }
    } catch (e) {
      log(
        `${p.id} SKIP ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`
      )
      continue
    }
    meta[p.url] = { id: p.id, source: p.source }
    log(`${p.id} ${p.repo}#${p.number} ok`)
  }
  const order = new Map(manifest.prs.map((p, i) => [p.url, i]))
  const urls = Object.keys(meta).sort(
    (a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)
  )
  writeFileSync(path.join(dataDir, 'prs.json'), JSON.stringify(urls, null, 1))
  writeFileSync(metaFile, JSON.stringify(meta, null, 1))
  log(`collected ${urls.length} PRs in ${dataDir} (${rows.length} requested)`)
}

main()
