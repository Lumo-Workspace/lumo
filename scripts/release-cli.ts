/**
 * LUM-1109: local release script for @lumoai/cli (CLI + bundled skill + hooks
 * all ship in the one npm package).
 *
 *   npm run release:cli -- --dry-run      # every check + changelog, no tag
 *   npm run release:cli                   # checks, changelog, tag cli-v<version>
 *
 * Steps (a real run stops at the first failure; --dry-run reports them all):
 *   1. git     — on `main`, clean, HEAD == origin/main (after `git fetch`).
 *   2. deploy  — the current production Vercel deployment contains HEAD, so the
 *                server APIs a new command calls already exist (otherwise a
 *                fresh CLI gets 404s). Unreadable → fail closed.
 *   3. npm     — cli/package.json's version is not on npm yet and the tag
 *                `cli-v<version>` does not exist. Unreadable → fail closed.
 *   4. changelog — since the last release (newest `cli-v*` tag that is an
 *                ancestor of HEAD; else the commit that set npm's latest
 *                version; or `--since <ref>`): command/flag changes from the
 *                grammar.json diff, hook changes, skill file changes, commits.
 *   5. tag     — annotated `cli-v<version>` whose message is the changelog.
 *   6. print the remaining human steps: `npm publish` (OTP) + push the tag.
 *
 * Read-only towards Vercel and npm; never prints or stores credentials. Does
 * not bump the version — each CLI PR still bumps its own (team convention).
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

export const CLI_PACKAGE = '@lumoai/cli'
export const TAG_PREFIX = 'cli-v'

const PACKAGE_JSON = 'cli/package.json'
const GRAMMAR_JSON = 'scripts/cli-grammar/grammar.json'
const HOOKS_TEMPLATE = 'cli/src/lib/hooks-template.ts'
const SKILL_DIR = '.claude/skills/lumo'
/** Paths whose commits/changes belong in the CLI changelog. */
const RELEASE_PATHS = ['cli', SKILL_DIR, GRAMMAR_JSON]

export type CommitInfo = { sha: string; subject: string }
export type FileChange = { status: string; path: string }

export interface ReleaseGit {
  fetchOrigin(): void
  currentBranch(): string
  statusPorcelain(): string
  /** Full SHA of a ref; throws when it does not resolve. */
  revParse(ref: string): string
  isAncestor(ancestor: string, descendant: string): boolean
  /** File content at a revision, or null when absent there. */
  showFile(ref: string, path: string): string | null
  listTags(pattern: string): string[]
  /** Commits that touched cli/package.json, newest first, with its version. */
  packageJsonHistory(): Iterable<{ sha: string; version: string }>
  log(base: string, head: string, paths: string[]): CommitInfo[]
  diffNameStatus(base: string, head: string, paths: string[]): FileChange[]
  createTag(name: string, message: string): void
}

export interface ReleaseVercel {
  /** The deployment currently serving production. Throws when unreadable. */
  productionDeployment(): { id: string; commitSha: string }
}

export interface ReleaseNpm {
  /** Every published version of the package. Throws when unreadable. */
  publishedVersions(pkg: string): string[]
}

export interface ReleaseDeps {
  git: ReleaseGit
  vercel: ReleaseVercel
  npm: ReleaseNpm
  write: (line: string) => void
  writeFile?: (path: string, content: string) => void
  today?: () => string
}

export interface ReleaseOptions {
  dryRun: boolean
  fetch: boolean
  since?: string
  changelogOut?: string
}

// ── pure helpers ────────────────────────────────────────────────────────────

const short = (sha: string) => sha.slice(0, 7)

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a) ?? [0, 0, 0]
  const pb = parseSemver(b) ?? [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function maxSemver(versions: string[]): string | null {
  const valid = versions.filter(v => parseSemver(v))
  if (valid.length === 0) return null
  return valid.reduce((best, v) => (compareSemver(v, best) > 0 ? v : best))
}

type GrammarFlag = { enum?: string[] | null }
type GrammarShape = {
  commands?: Record<string, { flags?: Record<string, GrammarFlag> }>
}

export type GrammarDiff = {
  addedCommands: string[]
  removedCommands: string[]
  addedFlags: string[]
  removedFlags: string[]
  changedEnums: string[]
}

/** Command-tree diff between two grammar.json documents (null = empty). */
export function diffGrammar(
  before: GrammarShape | null,
  after: GrammarShape | null
): GrammarDiff {
  const b = before?.commands ?? {}
  const a = after?.commands ?? {}
  const sorted = (xs: string[]) => [...xs].sort()
  const diff: GrammarDiff = {
    addedCommands: sorted(Object.keys(a).filter(c => !(c in b))),
    removedCommands: sorted(Object.keys(b).filter(c => !(c in a))),
    addedFlags: [],
    removedFlags: [],
    changedEnums: [],
  }
  for (const command of sorted(Object.keys(a).filter(c => c in b))) {
    const bf = b[command]?.flags ?? {}
    const af = a[command]?.flags ?? {}
    for (const f of sorted(Object.keys(af))) {
      if (!(f in bf)) {
        diff.addedFlags.push(`${command} ${f}`)
        continue
      }
      const be = bf[f]?.enum ?? []
      const ae = af[f]?.enum ?? []
      const plus = ae.filter(v => !be.includes(v)).map(v => `+${v}`)
      const minus = be.filter(v => !ae.includes(v)).map(v => `-${v}`)
      if (plus.length + minus.length > 0) {
        diff.changedEnums.push(
          `${command} ${f}: ${[...plus, ...minus].join(' ')}`
        )
      }
    }
    for (const f of sorted(Object.keys(bf))) {
      if (!(f in af)) diff.removedFlags.push(`${command} ${f}`)
    }
  }
  return diff
}

export type HookEvents = { claude: string[]; codex: string[] }

/** Reads LUMO_HOOK_EVENTS / CODEX_HOOK_EVENTS from hooks-template.ts source. */
export function parseHookEvents(source: string | null): HookEvents {
  const read = (name: string): string[] => {
    if (!source) return []
    const block = new RegExp(
      `export const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\n\\]`
    ).exec(source)
    if (!block?.[1]) return []
    return [...block[1].matchAll(/\[\s*'([A-Za-z]+)'\s*,\s*'[a-z-]+'\s*\]/g)]
      .map(m => m[1])
      .filter((x): x is string => typeof x === 'string')
  }
  return { claude: read('LUMO_HOOK_EVENTS'), codex: read('CODEX_HOOK_EVENTS') }
}

export type ChangelogInput = {
  packageName: string
  version: string
  date: string
  baselineLabel: string
  grammar: GrammarDiff
  hooks: { before: HookEvents; after: HookEvents }
  changedFiles: FileChange[]
  commits: CommitInfo[]
}

const isHookCommand = (entry: string) =>
  entry === 'hook' || entry.startsWith('hook ')
const isHookSource = (path: string) =>
  path.startsWith('cli/src/') &&
  /hook/.test(path.slice(path.lastIndexOf('/') + 1))

function grammarLines(
  g: GrammarDiff,
  pick: (entry: string) => boolean
): string[] {
  const lines: string[] = []
  const push = (label: string, xs: string[]) => {
    for (const x of xs.filter(pick)) lines.push(`- ${label}: \`lumo ${x}\``)
  }
  push('Added', g.addedCommands)
  push('Removed', g.removedCommands)
  push('Flag added', g.addedFlags)
  push('Flag removed', g.removedFlags)
  push('Flag values changed', g.changedEnums)
  return lines
}

export function renderChangelog(input: ChangelogInput): string {
  const { grammar, hooks } = input
  const notHook = (e: string) => !isHookCommand(e)
  const out: string[] = []
  const n = input.commits.length
  out.push(`## ${input.packageName} ${input.version} (${input.date})`, '')
  out.push(
    `Since ${input.baselineLabel} · ${n} commit${n === 1 ? '' : 's'}`,
    ''
  )

  out.push('### Commands', '')
  const commandLines = grammarLines(grammar, notHook)
  out.push(...(commandLines.length ? commandLines : ['- No changes']), '')

  out.push('### Hooks', '')
  const hookLines = grammarLines(grammar, isHookCommand)
  const eventDiff = (label: string, before: string[], after: string[]) => {
    const added = after.filter(e => !before.includes(e))
    const removed = before.filter(e => !after.includes(e))
    if (added.length)
      hookLines.push(`- ${label} events added: ${added.join(', ')}`)
    if (removed.length)
      hookLines.push(`- ${label} events removed: ${removed.join(', ')}`)
  }
  eventDiff('Claude Code', hooks.before.claude, hooks.after.claude)
  eventDiff('Codex', hooks.before.codex, hooks.after.codex)
  for (const f of input.changedFiles.filter(f => isHookSource(f.path))) {
    hookLines.push(`- ${f.status} ${f.path}`)
  }
  out.push(...(hookLines.length ? hookLines : ['- No changes']), '')

  out.push('### Skill', '')
  const skillLines = input.changedFiles
    .filter(f => f.path.startsWith(`${SKILL_DIR}/`))
    .map(f => `- ${f.status} ${f.path.slice(SKILL_DIR.length + 1)}`)
  out.push(...(skillLines.length ? skillLines : ['- No changes']), '')

  out.push('### Commits', '')
  const commitLines = input.commits.map(c => `- ${short(c.sha)} ${c.subject}`)
  out.push(...(commitLines.length ? commitLines : ['- No commits']), '')
  return out.join('\n')
}

/**
 * The last released commit: `--since`, else the newest `cli-v*` tag reachable
 * from HEAD, else the first commit at npm's latest published version.
 */
export function resolveBaseline(
  git: ReleaseGit,
  head: string,
  published: string[],
  since?: string,
  /** Only releases older than this version count (the one being released). */
  version?: string
): { sha: string; label: string } | null {
  if (since) return { sha: git.revParse(since), label: since }
  const older = (v: string) => !version || compareSemver(v, version) < 0

  const tagged = git
    .listTags(`${TAG_PREFIX}*`)
    .filter(
      t => t.startsWith(TAG_PREFIX) && parseSemver(t.slice(TAG_PREFIX.length))
    )
    .filter(t => older(t.slice(TAG_PREFIX.length)))
    .map(t => ({ tag: t, sha: git.revParse(t) }))
    .filter(t => git.isAncestor(t.sha, head))
  if (tagged.length > 0) {
    const best = tagged.reduce((x, y) =>
      compareSemver(
        y.tag.slice(TAG_PREFIX.length),
        x.tag.slice(TAG_PREFIX.length)
      ) > 0
        ? y
        : x
    )
    return { sha: best.sha, label: best.tag }
  }

  const latest = maxSemver(published.filter(older))
  if (!latest) return null
  let first: string | null = null
  for (const entry of git.packageJsonHistory()) {
    if (entry.version === latest) first = entry.sha
    else if (first) break
  }
  if (!first) return null
  return {
    sha: first,
    label: `npm ${latest} (${short(first)}, first commit at that version)`,
  }
}

// ── orchestration ───────────────────────────────────────────────────────────

/** YYYY-MM-DD in the releaser's local time zone. */
const localDate = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const errMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? ''

const parseJson = <T>(text: string | null): T | null => {
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** Runs the release; returns the process exit code. */
export function runRelease(opts: ReleaseOptions, deps: ReleaseDeps): number {
  const { git, write } = deps
  let failed = false
  const ok = (step: string, msg: string) => write(`✓ ${step}: ${msg}`)
  /** Records a failure; returns true when the run must stop now. */
  const fail = (step: string, msg: string): boolean => {
    write(`✗ ${step}: ${msg}`)
    failed = true
    return !opts.dryRun
  }

  write(
    opts.dryRun ? `${CLI_PACKAGE} release (dry run)` : `${CLI_PACKAGE} release`
  )

  // 1. git
  let head: string
  try {
    if (opts.fetch) git.fetchOrigin()
    head = git.revParse('HEAD')
    const problems: string[] = []
    const branch = git.currentBranch()
    if (branch !== 'main')
      problems.push(`not on main (on ${branch || 'detached HEAD'})`)
    if (git.statusPorcelain().trim() !== '')
      problems.push('working tree is not clean')
    const originMain = git.revParse('origin/main')
    if (originMain !== head) {
      problems.push(
        `HEAD ${short(head)} does not match origin/main ${short(originMain)}`
      )
    }
    if (problems.length > 0) {
      if (fail('git', problems.join('; '))) return 1
    } else {
      ok('git', `main is clean and at origin/main (${short(head)})`)
    }
  } catch (e) {
    fail('git', errMessage(e))
    return 1
  }

  // 2. production deploy contains HEAD
  let prod: { id: string; commitSha: string } | null = null
  try {
    prod = deps.vercel.productionDeployment()
  } catch (e) {
    if (
      fail(
        'deploy',
        `cannot confirm the production deployment (${errMessage(e)}) — failing closed`
      )
    ) {
      return 1
    }
  }
  if (prod) {
    try {
      if (git.isAncestor(head, prod.commitSha)) {
        ok(
          'deploy',
          `production ${prod.id} (${short(prod.commitSha)}) contains ${short(head)}`
        )
      } else if (
        fail(
          'deploy',
          `production ${prod.id} (${short(prod.commitSha)}) does not contain HEAD ${short(head)} — wait for the production deploy, then re-run`
        )
      ) {
        return 1
      }
    } catch (e) {
      if (
        fail(
          'deploy',
          `cannot tell whether production ${short(prod.commitSha)} contains HEAD (${errMessage(e)}) — failing closed; is the commit fetched?`
        )
      ) {
        return 1
      }
    }
  }

  // 3. npm + tag
  const pkg = parseJson<{ version?: string }>(git.showFile(head, PACKAGE_JSON))
  const version = pkg?.version
  if (!version || !parseSemver(version)) {
    fail('npm', `cannot read a version from ${PACKAGE_JSON}`)
    return 1
  }
  const tag = `${TAG_PREFIX}${version}`
  let published: string[] = []
  try {
    published = deps.npm.publishedVersions(CLI_PACKAGE)
    if (published.includes(version)) {
      if (
        fail(
          'npm',
          `${version} is already published — bump ${PACKAGE_JSON} first`
        )
      )
        return 1
    } else if (git.listTags(tag).includes(tag)) {
      if (fail('npm', `tag ${tag} already exists`)) return 1
    } else {
      ok(
        'npm',
        `${version} is not on npm yet (latest ${maxSemver(published) ?? 'none'})`
      )
    }
  } catch (e) {
    if (
      fail(
        'npm',
        `cannot read published versions (${errMessage(e)}) — failing closed`
      )
    ) {
      return 1
    }
  }

  // 4. changelog
  let changelog: string
  try {
    const baseline = resolveBaseline(git, head, published, opts.since, version)
    if (!baseline) {
      fail('changelog', 'no previous release found — pass --since <ref>')
      return 1
    }
    const grammarBefore = parseJson<GrammarShape>(
      git.showFile(baseline.sha, GRAMMAR_JSON)
    )
    const grammarAfter = parseJson<GrammarShape>(
      git.showFile(head, GRAMMAR_JSON)
    )
    changelog = renderChangelog({
      packageName: CLI_PACKAGE,
      version,
      date: (deps.today ?? localDate)(),
      baselineLabel: baseline.label,
      grammar: diffGrammar(grammarBefore, grammarAfter),
      hooks: {
        before: parseHookEvents(git.showFile(baseline.sha, HOOKS_TEMPLATE)),
        after: parseHookEvents(git.showFile(head, HOOKS_TEMPLATE)),
      },
      changedFiles: git.diffNameStatus(baseline.sha, head, [
        SKILL_DIR,
        'cli/src',
      ]),
      commits: git.log(baseline.sha, head, RELEASE_PATHS),
    })
    ok('changelog', `since ${baseline.label}`)
  } catch (e) {
    fail('changelog', errMessage(e))
    return 1
  }
  write('')
  write(changelog)
  if (opts.changelogOut) {
    const writeFile =
      deps.writeFile ?? ((p: string, c: string) => writeFileSync(p, c))
    writeFile(opts.changelogOut, changelog)
    write(`changelog written to ${opts.changelogOut}`)
  }

  if (failed) {
    write('Dry run finished with failing checks — nothing was tagged.')
    return 1
  }
  if (opts.dryRun) {
    write(`Dry run OK — a real run would tag ${tag} at ${short(head)}.`)
    return 0
  }

  // 5. tag
  try {
    git.createTag(tag, changelog)
    ok('tag', `created ${tag} at ${short(head)} (local only)`)
  } catch (e) {
    fail('tag', errMessage(e))
    return 1
  }

  // 6. human steps
  write('')
  write('Next (needs your npm OTP):')
  write(
    '  cd cli && npm publish            # prepublishOnly rebuilds dist + skills'
  )
  write(`  git push origin ${tag}`)
  write(`If publish fails: git tag -d ${tag}`)
  return 0
}

// ── real clients ────────────────────────────────────────────────────────────

function sh(cmd: string, args: string[], cwd: string): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (e) {
    throw withStderrReason(cmd, e)
  }
}

/**
 * execFileSync's message is just "Command failed: <argv>"; the reason is on
 * stderr. Keep its last non-empty line (capped) on the error's first line and
 * keep `status` so callers can still branch on the exit code.
 */
export function withStderrReason(cmd: string, e: unknown): Error {
  const err = e as {
    status?: number | null
    stderr?: unknown
    code?: unknown
    message?: unknown
  }
  const stderr = typeof err.stderr === 'string' ? err.stderr : ''
  // No stderr = the process never ran or was cut off (ENOENT, maxBuffer):
  // fall back to the spawn error's code / message so the cause survives.
  const spawnReason =
    typeof err.code === 'string'
      ? err.code
      : typeof err.message === 'string'
        ? err.message.split('\n')[0]
        : undefined
  const reason =
    stderr
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .pop() ?? spawnReason
  const message = `${cmd} failed${typeof err.status === 'number' ? ` (exit ${err.status})` : ''}${reason ? `: ${reason.slice(0, 200)}` : ''}`
  return Object.assign(new Error(message), { status: err.status })
}

export function createGit(cwd: string): ReleaseGit {
  const git = (...args: string[]) => sh('git', args, cwd)
  return {
    fetchOrigin: () => {
      git('fetch', '--quiet', '--tags', 'origin', 'main')
    },
    currentBranch: () => git('branch', '--show-current').trim(),
    statusPorcelain: () => git('status', '--porcelain'),
    revParse: ref => git('rev-parse', '--verify', `${ref}^{commit}`).trim(),
    isAncestor: (a, d) => {
      try {
        git('merge-base', '--is-ancestor', a, d)
        return true
      } catch (e) {
        if ((e as { status?: number }).status === 1) return false
        throw e
      }
    },
    showFile: (ref, path) => {
      try {
        return git('show', `${ref}:${path}`)
      } catch {
        return null
      }
    },
    listTags: pattern =>
      git('tag', '--list', pattern).split('\n').filter(Boolean),
    // Lazy: resolveBaseline stops reading at the first commit before the
    // version run it is looking for, so only a handful of `git show`s run.
    packageJsonHistory: function* () {
      const shas = git('log', '-n', '400', '--format=%H', '--', PACKAGE_JSON)
        .split('\n')
        .filter(Boolean)
      for (const sha of shas) {
        let content: string | null = null
        try {
          content = git('show', `${sha}:${PACKAGE_JSON}`)
        } catch {
          content = null
        }
        yield {
          sha,
          version: parseJson<{ version?: string }>(content)?.version ?? '',
        }
      }
    },
    log: (base, head, paths) =>
      git(
        'log',
        '--no-merges',
        '--format=%H%x09%s',
        `${base}..${head}`,
        '--',
        ...paths
      )
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const tab = line.indexOf('\t')
          return { sha: line.slice(0, tab), subject: line.slice(tab + 1) }
        }),
    diffNameStatus: (base, head, paths) =>
      git('diff', '--name-status', base, head, '--', ...paths)
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const cols = line.split('\t')
          return {
            status: (cols[0] ?? '?').charAt(0),
            path: cols[cols.length - 1] ?? '',
          }
        }),
    createTag: (name, message) => {
      // verbatim: the default cleanup strips the changelog's `## ` headings as comments
      git('tag', '-a', '--cleanup=verbatim', name, '-m', message)
    },
  }
}

/** Vercel project/team ids: env, else .vercel/project.json (worktree or main checkout). */
export function readVercelProject(cwd: string): {
  projectId: string
  orgId: string
} {
  const envProject = process.env.VERCEL_PROJECT_ID
  const envOrg = process.env.VERCEL_ORG_ID
  if (envProject && envOrg) return { projectId: envProject, orgId: envOrg }
  const commonDir = resolve(
    cwd,
    sh('git', ['rev-parse', '--git-common-dir'], cwd).trim()
  )
  for (const root of [cwd, dirname(commonDir)]) {
    const file = join(root, '.vercel', 'project.json')
    if (!existsSync(file)) continue
    const p = parseJson<{ projectId?: string; orgId?: string }>(
      readFileSync(file, 'utf8')
    )
    if (p?.projectId && p.orgId)
      return { projectId: p.projectId, orgId: p.orgId }
  }
  throw new Error(
    'no Vercel project link (.vercel/project.json or VERCEL_PROJECT_ID/VERCEL_ORG_ID)'
  )
}

export function createVercel(cwd: string): ReleaseVercel {
  return {
    productionDeployment: () => {
      const { projectId, orgId } = readVercelProject(cwd)
      let raw: string
      try {
        raw = sh(
          'vercel',
          ['api', `/v9/projects/${projectId}?teamId=${orgId}`, '--raw'],
          cwd
        )
      } catch (e) {
        throw new Error(
          `${errMessage(e)}; check \`vercel login\` / \`vercel link\``
        )
      }
      const project = parseJson<{
        targets?: {
          production?: {
            id?: string
            readyState?: string
            meta?: { githubCommitSha?: string }
          }
        }
      }>(raw)
      const prod = project?.targets?.production
      const sha = prod?.meta?.githubCommitSha
      if (!prod?.id || !sha)
        throw new Error('no production deployment with a commit SHA')
      if (prod.readyState !== 'READY') {
        throw new Error(
          `production deployment ${prod.id} is ${prod.readyState ?? 'unknown'}`
        )
      }
      return { id: prod.id, commitSha: sha }
    },
  }
}

export function createNpm(cwd: string): ReleaseNpm {
  return {
    publishedVersions: pkg => {
      const parsed = parseJson<unknown>(
        sh('npm', ['view', pkg, 'versions', '--json'], cwd)
      )
      if (typeof parsed === 'string') return [parsed]
      if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
        return parsed as string[]
      }
      throw new Error('unexpected `npm view` output')
    },
  }
}

export function parseArgs(argv: string[]): ReleaseOptions | 'help' {
  const opts: ReleaseOptions = { dryRun: false, fetch: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--no-fetch') opts.fetch = false
    else if (a === '--since' || a === '--changelog-out') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`missing value for ${a}`)
      }
      i++
      if (a === '--since') opts.since = value
      else opts.changelogOut = value
    } else if (a === '--help' || a === '-h') return 'help'
    else throw new Error(`unknown argument: ${a}`)
  }
  return opts
}

const USAGE = `Usage: npm run release:cli -- [--dry-run] [--no-fetch] [--since <ref>] [--changelog-out <file>]
See docs/cli-release.md.`

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('release-cli.ts')) {
  const write = (line: string) => process.stdout.write(`${line}\n`)
  try {
    const opts = parseArgs(process.argv.slice(2))
    if (opts === 'help') {
      write(USAGE)
      process.exit(0)
    }
    const cwd = sh(
      'git',
      ['rev-parse', '--show-toplevel'],
      process.cwd()
    ).trim()
    process.exit(
      runRelease(opts, {
        git: createGit(cwd),
        vercel: createVercel(cwd),
        npm: createNpm(cwd),
        write,
      })
    )
  } catch (e) {
    process.stderr.write(`${errMessage(e)}\n${USAGE}\n`)
    process.exit(2)
  }
}
