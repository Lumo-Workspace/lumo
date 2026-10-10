/**
 * LUM-988 replay — `RelatedSearch` over a local PR-head checkout with
 * `git grep` (every checkout is a git worktree; production searches the
 * sandbox VM's checkout with ripgrep instead). Vendored, generated and
 * minified files are skipped, and so is any hit on a line over 300 chars.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  RelatedHit,
  RelatedSearch,
} from '@/ee/security/security-scan/related-context'

const run = promisify(execFile)

const EXCLUDES = [
  ':!*.min.js',
  ':!*.min.css',
  ':!*.map',
  ':!*.lock',
  ':!.yarn/**',
  ':!vendor/**',
  ':!node_modules/**',
  ':!dist/**',
  ':!build/**',
  ':!**/vendor/**',
  ':!**/node_modules/**',
  ':!**/dist/**',
  ':!**/build/**',
  ':!**/*.snap',
]

async function gitGrep(
  cwd: string,
  args: string[],
  max: number
): Promise<RelatedHit[]> {
  try {
    const { stdout } = await run(
      'git',
      ['grep', '-n', '-I', '--no-color', ...args, '--', '.', ...EXCLUDES],
      { cwd, timeout: 20_000, maxBuffer: 64 * 1024 * 1024 }
    )
    const hits: RelatedHit[] = []
    for (const l of stdout.split('\n')) {
      const m = /^(.+?):(\d+):(.*)$/.exec(l)
      if (!m || m[3]!.length > 300) continue
      hits.push({ path: m[1]!, line: Number(m[2]) })
      if (hits.length >= max) break
    }
    return hits
  } catch (e) {
    // git grep exits 1 when nothing matches.
    if ((e as { code?: number }).code === 1) return []
    throw e
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** PCRE: a definition of `name` in Python/Ruby/JS/TS/Go/Java style. */
export function definitionPattern(name: string): string {
  const n = escapeRe(name)
  return [
    `\\b(def|function|func|class|interface|struct|enum|module|trait|type)\\s+(self\\.)?(\\([^)]*\\)\\s*)?${n}\\b`,
    `\\b${n}\\s*[:=]\\s*(async\\s*)?(function\\b|\\()`,
    `^\\s*((public|private|protected|static|final|abstract|synchronized|override|async)\\s+)*[\\w<>\\[\\],.?]+\\s+${n}\\s*\\(`,
  ].join('|')
}

export function gitGrepSearch(cwd: string): RelatedSearch {
  return {
    usages: (name, max) => gitGrep(cwd, ['-w', '-F', '-e', name], max),
    definitions: (name, max) =>
      gitGrep(cwd, ['-P', '-e', definitionPattern(name)], max),
    read: async p => {
      const f = path.join(cwd, p)
      return existsSync(f) ? readFileSync(f, 'utf8') : null
    },
  }
}
