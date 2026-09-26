import {
  splitSegmentsQuoteAware,
  unwrapShellWrapper,
  verbOf,
} from '@/lib/boundary-crossing/command-shape'

/**
 * LUM-840 — what a Bash tool call was FOR, so operation cost can split the one
 * giant `Bash` row into purposes (reading code vs running tests vs the lumo
 * CLI …). Stored as a slug on `HookEvent.toolDetail`; the display label lives
 * in {@link BASH_CATEGORY_LABEL}.
 *
 * A compound command (`cd x && npx jest …`, `for …; do lumo …; done`) resolves
 * to its MOST SIGNIFICANT segment by {@link BASH_CATEGORY_PRIORITY}, not its
 * first word — the first word is usually `cd` / `export` / `for`, which says
 * nothing about where the tokens went.
 */
export const BASH_CATEGORIES = [
  'test',
  'check',
  'db',
  'git-write',
  'gh',
  'lumo',
  'net',
  'script',
  'file',
  'read',
  'other',
] as const

export type BashCategory = (typeof BASH_CATEGORIES)[number]

/** Most significant first: the winning segment decides the whole command. */
export const BASH_CATEGORY_PRIORITY: readonly BashCategory[] = BASH_CATEGORIES

export const BASH_CATEGORY_LABEL: Record<BashCategory, string> = {
  test: 'test',
  check: 'typecheck/lint/build',
  db: 'db/prisma',
  'git-write': 'git write',
  gh: 'gh',
  lumo: 'lumo CLI',
  net: 'network/deploy',
  script: 'script',
  file: 'file ops',
  read: 'read/search',
  other: 'other',
}

export function isBashCategory(v: unknown): v is BashCategory {
  return (
    typeof v === 'string' && (BASH_CATEGORIES as readonly string[]).includes(v)
  )
}

/** Plumbing that says nothing about purpose — skipped, never a category. */
const NOISE_VERBS = new Set([
  '',
  'cd',
  'pushd',
  'popd',
  'export',
  'unset',
  'set',
  'source',
  '.',
  'echo',
  'printf',
  'sleep',
  'date',
  'true',
  'false',
  ':',
  'pwd',
  'for',
  'done',
  'fi',
  'esac',
  'case',
  'in',
  'local',
  'read',
  'wait',
  'exit',
  'return',
  'trap',
  'tee',
  'xargs',
  'test',
  '[',
  '[[',
])

const READ_VERBS = new Set([
  'cat',
  'sed',
  'awk',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ast-grep',
  'ls',
  'find',
  'fd',
  'tree',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'sort',
  'uniq',
  'tr',
  'cut',
  'diff',
  'comm',
  'jq',
  'yq',
  'which',
  'type',
  'file',
  'stat',
  'du',
  'realpath',
  'basename',
  'dirname',
  'column',
  'nl',
])

const GIT_READ = new Set([
  'log',
  'grep',
  'show',
  'diff',
  'status',
  'merge-base',
  'rev-parse',
  'rev-list',
  'ls-tree',
  'ls-files',
  'ls-remote',
  'blame',
  'describe',
  'shortlog',
  'reflog',
  'name-rev',
  'cat-file',
  'cherry',
  'branch',
  'remote',
  'config',
  'tag',
])

const FILE_VERBS = new Set([
  'rm',
  'rmdir',
  'cp',
  'mv',
  'mkdir',
  'touch',
  'ln',
  'chmod',
  'tar',
  'unzip',
  'zip',
])

const SCRIPT_VERBS = new Set([
  'python',
  'python3',
  'node',
  'tsx',
  'ts-node',
  'bun',
  'deno',
  'bash',
  'sh',
  'zsh',
])

const TEST_VERBS = new Set(['jest', 'vitest', 'playwright', 'mocha'])
const CHECK_VERBS = new Set(['tsc', 'eslint', 'prettier', 'next', 'turbo'])
/** `npm test`, `npm run test:unit`, `pnpm lint` … → the script name. Matched on
 *  the raw segment: `verbOf` skips `pnpm` / `yarn` as launcher prefixes. */
const PKG_SCRIPT =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?([\w:.-]+)/

function classifySegment(segment: string): BashCategory | null {
  // Subshell / group openers carry no verb of their own.
  const seg = segment.trim().replace(/^[({]\s*/, '')
  if (!seg) return null
  const parsed = verbOf(seg)
  // `(cd x && npx jest)` leaves the group closer glued to the last verb.
  const verb = parsed.verb.replace(/[)}]+$/, '')
  const rest = parsed.rest
  if (NOISE_VERBS.has(verb)) return null

  // Checked on the whole segment: `npx tsx scripts/jest-t.ts …` runs jest.
  if (TEST_VERBS.has(verb) || /\bjest-t\.ts\b/.test(seg)) return 'test'
  const script = seg.match(PKG_SCRIPT)?.[1]
  if (script !== undefined && !/\.[cm]?[jt]sx?$/.test(script)) {
    if (/^(?:install|i|ci|link|view|publish|pack|ls|outdated)$/.test(script))
      return 'other'
    if (/^test\b/.test(script)) return 'test'
    if (
      /^(?:lint|build|typecheck|type-check|tsc|i18n:check|format)/.test(script)
    )
      return 'check'
    if (/^(?:prisma|db|migrate)/.test(script)) return 'db'
    return 'script'
  }
  if (CHECK_VERBS.has(verb)) return 'check'
  if (verb === 'prisma' || verb === 'psql') return 'db'
  if (verb === 'git') {
    let j = 0
    while (j < rest.length && rest[j]!.startsWith('-')) {
      // `git -C <dir>` / `-c k=v` take a value.
      if (rest[j] === '-C' || rest[j] === '-c') j++
      j++
    }
    return GIT_READ.has(rest[j] ?? '') ? 'read' : 'git-write'
  }
  if (verb === 'gh') return 'gh'
  if (verb === 'lumo') return 'lumo'
  if (verb === 'vercel' || verb === 'curl' || verb === 'wget') return 'net'
  if (SCRIPT_VERBS.has(verb)) return 'script'
  if (FILE_VERBS.has(verb)) return 'file'
  if (READ_VERBS.has(verb)) return 'read'
  return 'other'
}

function collect(cmd: string, out: BashCategory[], depth: number): void {
  for (const raw of splitSegmentsQuoteAware(cmd)) {
    const seg = raw.trim()
    if (!seg) continue
    const inner = depth < 3 ? unwrapShellWrapper(seg) : null
    if (inner != null) {
      collect(inner, out, depth + 1)
      continue
    }
    const c = classifySegment(seg)
    if (c) out.push(c)
  }
}

/**
 * The purpose of one Bash command. Pure + deterministic. A command made only
 * of plumbing (`echo`, `cd`, `sleep` …) or that is empty is `other`.
 */
export function classifyBashCommand(command: string): BashCategory {
  const found: BashCategory[] = []
  collect(command, found, 0)
  if (found.length === 0) return 'other'
  let best = found[0]!
  for (const c of found) {
    if (
      BASH_CATEGORY_PRIORITY.indexOf(c) < BASH_CATEGORY_PRIORITY.indexOf(best)
    )
      best = c
  }
  return best
}

/**
 * `toolDetail` for a hook payload: the Bash category when the payload is a
 * Bash call with a readable command, else null. Shared by the record path and
 * the historical backfill so both classify identically.
 */
export function toolDetailFromPayload(payload: unknown): BashCategory | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { tool_name?: unknown; tool_input?: unknown }
  if (p.tool_name !== 'Bash') return null
  const input = p.tool_input as { command?: unknown } | null | undefined
  const command = input?.command
  if (typeof command !== 'string') return null
  return classifyBashCommand(command)
}
