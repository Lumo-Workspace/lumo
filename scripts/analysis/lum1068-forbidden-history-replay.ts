/**
 * LUM-1068 — replay a repository's real CLAUDE.md / AGENTS.md history through
 * the core `## Forbidden` parser and judge (read only: `git show` of each
 * commit, nothing is written).
 *
 *   npx tsx scripts/analysis/lum1068-forbidden-history-replay.ts [repoPath]
 *
 * For every commit that touched either file (all refs, oldest first), the
 * rule set of its first parent and of the commit are parsed and diffed, and
 * each removed rule is judged as the detector would (HIGH / MEDIUM).
 *
 * Reference ("ground truth") per commit, independent of the parser: the
 * bullet lines that were under a `## Forbidden` heading before and are not
 * under one after (raw line compare, whitespace trimmed). A detection on a
 * commit without such a line is a false positive; such a line without a
 * detection is a false negative.
 */
import { execFileSync } from 'child_process'
import {
  forbiddenRuleSourceText,
  forbiddenRuleWeakeningVerdict,
  parseForbiddenRuleSet,
  removedForbiddenRules,
  sameRuleText,
  type ForbiddenRuleSourceFile,
} from '../../lib/boundary-crossing/forbidden-rules'

const repo = process.argv[2] ?? process.cwd()
const FILES = ['CLAUDE.md', 'AGENTS.md']

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

function show(rev: string | undefined, path: string): string | null {
  if (!rev) return null
  try {
    return git('show', `${rev}:${path}`)
  } catch {
    return null
  }
}

function filesAt(rev: string | undefined): ForbiddenRuleSourceFile[] {
  return FILES.map(path => ({ path, content: show(rev, path) }))
}

/** Raw bullet lines under any `## Forbidden` heading (reference only). */
function rawForbiddenBullets(files: ForbiddenRuleSourceFile[]): Set<string> {
  const out = new Set<string>()
  for (const f of files) {
    let on = false
    for (const line of (f.content ?? '').split('\n')) {
      if (/^#{1,2}\s/.test(line)) on = /^##\s+forbidden\b/i.test(line)
      else if (on && /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/.test(line))
        out.add(line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ''))
    }
  }
  return out
}

const commits = git(
  'log',
  '--all',
  '--topo-order',
  '--reverse',
  '--format=%H %P',
  '--',
  ...FILES
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .map(l => l.split(' '))

let sectionChanges = 0
let detections = 0
let falsePositives = 0
let falseNegatives = 0
const lines: string[] = []
for (const [sha, parent] of commits) {
  const before = filesAt(parent)
  const after = filesAt(sha)
  const rawBefore = [...rawForbiddenBullets(before)]
  const rawAfter = [...rawForbiddenBullets(after)]
  // Reference removals: a bullet whose words are under no Forbidden heading
  // any more (a reformatted bullet is not a removal).
  const expected = rawBefore.filter(
    l => !rawAfter.some(a => sameRuleText(a, l))
  )
  const changed =
    rawBefore.length !== rawAfter.length ||
    rawBefore.some((l, i) => l !== rawAfter[i])
  if (changed) sectionChanges++

  const removed = removedForbiddenRules(
    parseForbiddenRuleSet(before),
    parseForbiddenRuleSet(after)
  )
  const source = forbiddenRuleSourceText(after)
  const verdicts = removed.map(r => {
    const v = forbiddenRuleWeakeningVerdict(r, source)
    return `${v.severity}${v.advisory ? '/advisory' : ''} "${r.text}"`
  })
  detections += removed.length
  falsePositives += removed.filter(
    r => !expected.some(l => sameRuleText(l, r.text))
  ).length
  falseNegatives += expected.filter(
    l => !removed.some(r => sameRuleText(l, r.text))
  ).length
  const subject = git('log', '-1', '--format=%ad %s', '--date=short', sha!)
    .trim()
    .slice(0, 72)
  lines.push(
    `${sha!.slice(0, 9)} ${subject}\n    forbidden section changed: ${changed} | reference removals: ${expected.length} | recorded: ${verdicts.length ? verdicts.join('; ') : 'none'}`
  )
}

process.stdout.write(
  `${lines.join('\n')}\n\ncommits: ${commits.length} | Forbidden section changes: ${sectionChanges} | recorded: ${detections} | false positives: ${falsePositives} | false negatives: ${falseNegatives}\n`
)
