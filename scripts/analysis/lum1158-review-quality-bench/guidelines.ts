/**
 * LUM-1199 — each benchmark repository's own guidelines, as they were at
 * hash X, turned into LUM-1147 path instructions (`guidelines-lib.ts` holds
 * the deterministic mapping). Free: reads the `collect.ts` checkouts only.
 *
 *   npx tsx scripts/analysis/lum1158-review-quality-bench/guidelines.ts \
 *     --checkouts <dir> --data <data dir> --out <scratch>/instructions.json \
 *     [--ids oss-01,oss-02] [--manifest <file>]
 *
 * Writes `{ [prUrl]: PathInstruction[] }` for `replay.ts --instructions`,
 * and prints one row per PR: guideline files found (by kind), entries,
 * entries cut by the cap, entries matching the PR's changed files, and the
 * rendered block's size. Third-party text: the output file belongs in the
 * scratch dir, never in the repository; the printed table holds no text.
 *
 * `own` rows get Lumo's real settings for its repository, passed as
 * `--own <file>` (a JSON PathInstruction[]; omitted = none configured).
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { PathInstruction } from '@/ee/security/security-scan/path-instructions'
import { prKey } from '../lum988-code-review-replay/pr-key'
import { changedPaths, insideDir, type Manifest } from './bench-lib'
import {
  buildRepoPathInstructions,
  classifyGuidelineFile,
  type GuidelineDoc,
} from './guidelines-lib'
import { replayPathInstructions } from './path-instructions-input'

/** Same bound as `collect.ts` for files read from a third-party checkout. */
const MAX_FILE_BYTES = 200_000

function opt(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (v === undefined) throw new Error(`--${name} is required`)
  return v
}

const checkouts = opt('checkouts')
const dataDir = opt('data')
const outFile = opt('out')
const manifestFile = opt('manifest', path.join(__dirname, 'manifest.json'))
const ownFile = opt('own', '')
const only = new Set(opt('ids', '').split(',').filter(Boolean))

const log = (s: string) => process.stdout.write(`${s}\n`)

function readGuidelines(co: string): GuidelineDoc[] {
  const listed = execFileSync('git', ['-C', co, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
  const root = realpathSync(co)
  const seen = new Set<string>()
  const docs: GuidelineDoc[] = []
  for (const f of listed.sort()) {
    if (!classifyGuidelineFile(f)) continue
    const src = path.resolve(co, f)
    // Third-party checkout: never read a path, or a symlink, out of it.
    if (!insideDir(co, src) || !existsSync(src)) continue
    const real = realpathSync(src)
    if (!insideDir(root, real)) continue
    // CLAUDE.md -> AGENTS.md and the like: one file, read once.
    if (seen.has(real)) continue
    seen.add(real)
    const st = lstatSync(real)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue
    docs.push({ path: f, text: readFileSync(real, 'utf8') })
  }
  return docs
}

function main(): void {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
  const rows = manifest.prs.filter(p => only.size === 0 || only.has(p.id))
  const own: PathInstruction[] = ownFile
    ? (JSON.parse(readFileSync(ownFile, 'utf8')) as PathInstruction[])
    : []
  const out: Record<string, PathInstruction[]> = {}
  log(
    '| PR | guideline files (kinds) | entries | cut | matching | rendered chars |'
  )
  log('| --- | --- | --- | --- | --- | --- |')
  let withAny = 0
  let withMatch = 0
  for (const p of rows) {
    const key = prKey(p.url)
    let list: PathInstruction[]
    let files = '—'
    let cut = 0
    if (p.source === 'own') {
      list = own
      files = ownFile ? 'repository settings' : 'none configured'
    } else {
      const co = path.join(checkouts, 'co', key)
      const head = execFileSync('git', ['-C', co, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim()
      if (head !== p.hashX)
        throw new Error(`${p.id}: checkout is at ${head}, not hash X`)
      const built = buildRepoPathInstructions(readGuidelines(co))
      list = built.instructions
      cut = built.dropped
      const kinds = new Map<string, number>()
      for (const s of built.sources)
        kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1)
      files =
        built.sources.length === 0
          ? 'none'
          : `${built.sources.length} (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')})`
    }
    out[p.url] = list
    const diffFile = path.join(dataDir, key, 'diff.patch')
    const changed = existsSync(diffFile)
      ? changedPaths(readFileSync(diffFile, 'utf8'))
      : []
    const rendered = replayPathInstructions(list, changed)
    if (list.length > 0) withAny++
    if (rendered.sent.length > 0) withMatch++
    log(
      `| ${p.id} | ${files} | ${list.length} | ${cut} | ${rendered.sent.length} | ${rendered.text.length} |`
    )
  }
  writeFileSync(outFile, JSON.stringify(out, null, 1))
  log(
    `\n${withAny}/${rows.length} PRs have instructions; ${withMatch} have at least one matching a changed file. Wrote ${outFile}.`
  )
}

main()
