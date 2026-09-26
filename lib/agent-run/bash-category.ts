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
  // Above `read`: an unrecognised command must surface as `other` (the signal
  // that a rule is missing) rather than hide behind a grep/cat beside it.
  'other',
  'read',
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
  'ps',
  'pgrep',
  'lsof',
  'od',
  'hexdump',
  'xxd',
  'md5',
  'md5sum',
  'shasum',
  'sha256sum',
  'base64',
  'printenv',
  'df',
  'uname',
  'whoami',
  'hostname',
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
  'perl',
  'ruby',
  'php',
])

/** A script run by path: `./start-server.sh`, `scripts/run_mut.py`. */
const SCRIPT_FILE = /\.(?:sh|bash|zsh|py|rb|pl|js|mjs|cjs|ts)$/

const TEST_VERBS = new Set([
  'jest',
  'vitest',
  'playwright',
  'mocha',
  'pytest',
  'rspec',
  'tox',
  'nox',
  'phpunit',
])
const CHECK_VERBS = new Set([
  'tsc',
  'eslint',
  'prettier',
  'next',
  'turbo',
  'make',
  'ruff',
  'mypy',
  'black',
  'isort',
  'flake8',
  'pylint',
  'pyright',
  'golangci-lint',
  'gofmt',
  'rubocop',
  'biome',
  'cmake',
])
const NET_VERBS = new Set([
  'vercel',
  'curl',
  'wget',
  'docker',
  'docker-compose',
  'podman',
  'kubectl',
  'helm',
  'terraform',
  'aws',
  'gcloud',
  'az',
  'fly',
  'flyctl',
  'netlify',
  'wrangler',
])

/** Build tools whose SUBCOMMAND says test vs build: `go test`, `cargo build`,
 *  `mvn package`, `./gradlew test`, `dotnet test`. Anything else they do
 *  (`go run`, `cargo add` …) is build-ish tooling → `check`. */
const SUBCOMMAND_TOOLS = new Set([
  'go',
  'cargo',
  'mvn',
  'mvnw',
  'gradle',
  'gradlew',
  'dotnet',
  'swift',
])
const TEST_SUBCOMMAND = /^(?:test|nextest|verify)$/
const ASSIGNMENTS_ONLY =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*)+$/
const TIMEOUT_PREFIX = /^(?:g?timeout)\s+(?:-\S+\s+)*\S+\s+/

/** Wrappers that run another command: `uv run pytest`, `poetry run mypy`,
 *  `bundle exec rspec`, `python -m pytest`. Classified by what they run. */
const RUNNER =
  /^(?:uv|poetry|pipenv|pdm|hatch|rye)\s+run\s+|^bundle\s+exec\s+|^python[\d.]*\s+-m\s+/
/** `npm test`, `npm run test:unit`, `pnpm lint` … → the script name. Matched on
 *  the raw segment: `verbOf` skips `pnpm` / `yarn` as launcher prefixes. */
const PKG_SCRIPT =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?([\w:.-]+)/

/** Subshell / group openers and the control keywords that introduce a
 *  command. Stripped up front so `do c=$(grep …)` reaches `verbOf`'s
 *  `VAR=$(cmd` handling instead of reading the assignment as a prefix. */
const SEGMENT_OPENER = /^(?:[({]\s*|(?:do|then|else|elif|if|while|until)\s+)+/

/** A segment's verb, or null when it is empty or a `#` comment line. */
function segmentVerb(
  segment: string
): { seg: string; verb: string; rest: string[] } | null {
  const seg = segment.trim().replace(SEGMENT_OPENER, '')
  if (!seg || seg.startsWith('#')) return null
  const parsed = verbOf(seg)
  // `(cd x && npx jest)` / `"$D/tool" …` leave a closer or quote glued on.
  return { seg, verb: parsed.verb.replace(/["')}]+$/, ''), rest: parsed.rest }
}

function classifySegment(segment: string): BashCategory | null {
  const parsed = segmentVerb(segment)
  if (!parsed) return null
  const { seg, verb, rest } = parsed
  if (NOISE_VERBS.has(verb)) return null
  // A segment that only assigns variables (`S=/tmp/x;`) runs nothing.
  if (ASSIGNMENTS_ONLY.test(seg)) return null
  const timeout = seg.match(TIMEOUT_PREFIX)
  if (timeout) return classifySegment(seg.slice(timeout[0].length))
  const runner = seg.match(RUNNER)
  if (runner) return classifySegment(seg.slice(runner[0].length))
  if (SUBCOMMAND_TOOLS.has(verb)) {
    const sub = rest.find(t => !t.startsWith('-')) ?? ''
    return TEST_SUBCOMMAND.test(sub) ? 'test' : 'check'
  }
  if (verb === 'make' && /^test/.test(rest[0] ?? '')) return 'test'

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
  if (NET_VERBS.has(verb)) return 'net'
  if (SCRIPT_VERBS.has(verb) || SCRIPT_FILE.test(verb)) return 'script'
  if (FILE_VERBS.has(verb)) return 'file'
  if (READ_VERBS.has(verb)) return 'read'
  return 'other'
}

function collect(
  cmd: string,
  out: { category: BashCategory; segment: string }[],
  depth: number
): void {
  for (const raw of splitSegmentsQuoteAware(cmd)) {
    const seg = raw.trim()
    if (!seg) continue
    const inner = depth < 3 ? unwrapShellWrapper(seg) : null
    if (inner != null) {
      collect(inner, out, depth + 1)
      continue
    }
    const category = classifySegment(seg)
    if (category) out.push({ category, segment: seg })
  }
}

/**
 * The verbs of a command's segments that no rule recognised (classified
 * `other`) — what to add a rule for when `Bash · other` grows. Deduped, in
 * order of appearance.
 */
export function unrecognisedVerbs(command: string): string[] {
  const found: { category: BashCategory; segment: string }[] = []
  collect(command, found, 0)
  const verbs = found
    .filter(f => f.category === 'other')
    .map(f => segmentVerb(f.segment)?.verb.slice(0, 40) ?? '')
    .filter(Boolean)
  return [...new Set(verbs)]
}

/**
 * The purpose of one Bash command. Pure + deterministic. A command made only
 * of plumbing (`echo`, `cd`, `sleep` …) or that is empty is `other`.
 */
export function classifyBashCommand(command: string): BashCategory {
  const found: { category: BashCategory; segment: string }[] = []
  collect(command, found, 0)
  if (found.length === 0) return 'other'
  let best = found[0]!.category
  for (const { category: c } of found) {
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
