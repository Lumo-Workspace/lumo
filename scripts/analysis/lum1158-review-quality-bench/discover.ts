/**
 * LUM-1158 — draw the benchmark's fixed PR set into manifest.json.
 *
 * oss rows: public merged PRs the reference reviewer (bot-a) reviewed, one
 * GitHub search per merge day, shuffled with a fixed seed, kept when
 *   - the repository license is in PERMISSIVE_LICENSES and it has ≥ --min-stars
 *     (the LUM-1010 pilot was dominated by 1-star agent repos),
 *   - the author is not a bot, the PR changed ≤ --max-lines lines,
 *   - bot-a's first review commit (hash X) is still in the PR history, bot-a
 *     left ≥ 1 inline comment on it, and ≥ 1 non-merge commit came after it
 *     (otherwise there is no ground truth),
 *   - at most one PR per repository.
 * own rows: Lumo's own merged PRs that Lumo's app reviewed, same rules minus
 * license/stars (scored for Lumo only: bot-a never reviewed them).
 *
 * bot-a's real login is read from BENCH_REFERENCE_LOGIN (the full app login,
 * `<app>[bot]`) and never written anywhere: the manifest only says `bot-a`.
 *
 *   BENCH_REFERENCE_LOGIN='<app>[bot]' npx tsx \
 *     scripts/analysis/lum1158-review-quality-bench/discover.ts \
 *     --start 2026-09-01 --end 2026-10-10 --oss 40 --own 10 \
 *     [--own-start … --own-end …] [--per-day 3] [--min-stars 100] \
 *     [--max-lines 2000] [--seed 1158] [--out <manifest.json>]
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  REFERENCE_LABEL,
  commitsAfter,
  dayRange,
  findReviewCommit,
  isPermissiveLicense,
  referenceReviewAt,
  seededRandom,
  shuffled,
  validateManifest,
  type BenchSource,
  type GhCommit,
  type GhReview,
  type GhReviewComment,
  type Manifest,
  type ManifestEntry,
} from './bench-lib'
import { ghList, searchPrs, type SearchItem } from './github'

const OWN_REPO = 'Lumo-Workspace/lumo'
const OWN_LOGIN = 'uselumo[bot]'
const SEARCH_SLEEP_MS = 2_500 // authenticated Search API: 30 requests / minute

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}

const start = opt('start')
const end = opt('end')
const ossTarget = Number(opt('oss', '40'))
const ownTarget = Number(opt('own', '10'))
const ownStart = opt('own-start', start)
const ownEnd = opt('own-end', end)
const perDay = Number(opt('per-day', '3'))
const minStars = Number(opt('min-stars', '100'))
const maxLines = Number(opt('max-lines', '2000'))
const seed = Number(opt('seed', '1158'))
const out = opt('out', path.join(__dirname, 'manifest.json'))
const referenceLogin = process.env.BENCH_REFERENCE_LOGIN ?? ''

const log = (s: string) => process.stdout.write(`${s}\n`)

/** The manifest row for a candidate PR, or a reason to skip it. */
function evaluate(
  item: SearchItem,
  source: BenchSource,
  login: string
): Omit<ManifestEntry, 'id'> | string {
  if (item.authorIsBot) return 'bot author'
  const repo = item.repo
  let license = 'LicenseRef-Lumo'
  let stars = 0
  if (source === 'oss') {
    license = item.license ?? 'NOASSERTION'
    stars = item.stars
    if (item.fork) return 'fork'
    if (!isPermissiveLicense(license)) return `license ${license}`
    if (stars < minStars) return `${stars} stars`
  }
  if (!item.mergedAt) return 'not merged'
  const changedLines = item.changedLines
  if (changedLines > maxLines) return `${changedLines} lines`
  const reviews = ghList<GhReview>(`repos/${repo}/pulls/${item.number}/reviews`)
  const hashX = findReviewCommit(reviews, login)
  if (!hashX) return 'no review commit'
  const commits = ghList<GhCommit>(`repos/${repo}/pulls/${item.number}/commits`)
  const after = commitsAfter(commits, hashX)
  if (!after) return 'hash X not in history'
  if (after.length === 0) return 'no post-review commits'
  if (source === 'oss') {
    const comments = ghList<GhReviewComment>(
      `repos/${repo}/pulls/${item.number}/comments`
    )
    if (referenceReviewAt(reviews, comments, login, hashX).inline.length === 0)
      return 'no inline comment at hash X'
  }
  return {
    url: item.url,
    repo,
    number: item.number,
    source,
    reviewerOfRecord: source === 'oss' ? REFERENCE_LABEL : 'lumo',
    hashX,
    base: item.base,
    head: item.head,
    license,
    stars,
    changedLines,
    postReviewCommits: after.length,
    mergedAt: item.mergedAt,
  }
}

async function draw(
  source: BenchSource,
  login: string,
  days: string[],
  target: number,
  rand: () => number,
  extraQuery: string
): Promise<ManifestEntry[]> {
  const rows: ManifestEntry[] = []
  const repos = new Set<string>()
  for (const day of shuffled(days, rand)) {
    if (rows.length >= target) break
    const visibility = source === 'oss' ? 'is:public ' : ''
    const q =
      `type:pr is:merged ${visibility}reviewed-by:${login} merged:${day} ${extraQuery}`.trim()
    const items = shuffled(await searchPrs(q), rand)
    await new Promise(r => setTimeout(r, SEARCH_SLEEP_MS))
    let picked = 0
    for (const item of items) {
      if (picked >= perDay || rows.length >= target) break
      const repo = item.repo
      if (source === 'oss' && repos.has(repo)) continue
      let row: ReturnType<typeof evaluate>
      try {
        row = evaluate(item, source, login)
      } catch (e) {
        row = `error ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`
      }
      if (typeof row === 'string') continue
      repos.add(repo)
      picked++
      rows.push({ id: '', ...row })
    }
    log(
      `${source} ${day}: ${items.length} results, picked ${picked} (total ${rows.length})`
    )
  }
  return rows
}

async function main(): Promise<void> {
  if (!referenceLogin) throw new Error('BENCH_REFERENCE_LOGIN is required')
  const rand = seededRandom(seed)
  const oss = await draw(
    'oss',
    referenceLogin,
    dayRange(start, end),
    ossTarget,
    rand,
    ''
  )
  const own = ownTarget
    ? await draw(
        'own',
        OWN_LOGIN,
        dayRange(ownStart, ownEnd),
        ownTarget,
        rand,
        `repo:${OWN_REPO}`
      )
    : []
  const pad = (n: number) => String(n + 1).padStart(2, '0')
  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString().slice(0, 10),
    reference: REFERENCE_LABEL,
    criteria: {
      ossMerged: `${start}..${end}`,
      ownMerged: `${ownStart}..${ownEnd}`,
      perDay,
      minStars,
      maxChangedLines: maxLines,
      seed,
      onePerRepository: true,
      requiresInlineReferenceComment: true,
      requiresPostReviewCommit: true,
    },
    prs: [
      ...oss.map((r, i) => ({ ...r, id: `oss-${pad(i)}` })),
      ...own.map((r, i) => ({ ...r, id: `own-${pad(i)}` })),
    ],
  }
  const errors = validateManifest(manifest)
  if (errors.length) throw new Error(`invalid manifest:\n${errors.join('\n')}`)
  // Belt and braces: the reference's real login must never reach the file.
  const text = `${JSON.stringify(manifest, null, 1)}\n`
  if (
    text
      .toLowerCase()
      .includes(referenceLogin.replace('[bot]', '').toLowerCase())
  )
    throw new Error('manifest would contain the reference login')
  writeFileSync(out, text)
  log(`wrote ${out}: ${oss.length} oss + ${own.length} own PRs`)
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
