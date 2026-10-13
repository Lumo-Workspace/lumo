/**
 * LUM-1109 / LUM-1119: local release script for @lumoai/cli (CLI + bundled
 * skill + hooks all ship in the one npm package).
 *
 * The CLI version is bumped once per release, not per PR (LUM-1119): ordinary
 * CLI PRs leave cli/package.json alone. A release is two runs:
 *
 *   npm run release:cli -- --bump <patch|minor|major> [--dry-run]
 *       Opens the release PR. From the latest origin/main: new version = the
 *       level applied to max(npm's highest published, main's version); creates
 *       branch `lumo/release-cli-v<new>`, writes the version into
 *       cli/package.json + package-lock.json, regenerates grammar.json
 *       (emit-grammar), checks the three agree, commits
 *       `chore: release CLI v<new> [skip-drift]`, pushes, `gh pr create` with
 *       a changelog draft — then stops. It never merges.
 *
 *   npm run release:cli -- --version <x.y.z> [--dry-run]
 *       After the release PR is merged and production is deployed (or when
 *       main already carries an unpublished version): the release checks.
 *         1. git     — on `main`, clean, HEAD == origin/main (after `git fetch`).
 *         2. deploy  — the current production Vercel deployment contains HEAD,
 *                      so the server APIs a new command calls already exist
 *                      (otherwise a fresh CLI gets 404s). Unreadable → fail closed.
 *         3. npm     — cli/package.json at HEAD is <x.y.z>, it is higher than
 *                      every published version, and the tag `cli-v<x.y.z>`
 *                      does not exist. Unreadable → fail closed.
 *         4. changelog — since the last release (newest `cli-v*` tag that is an
 *                      ancestor of HEAD; else the commit that set npm's latest
 *                      version; or `--since <ref>`): command/flag changes from
 *                      the grammar.json diff, hook changes, skill file changes,
 *                      commits.
 *         5. tag     — annotated `cli-v<x.y.z>` whose message is the changelog.
 *         6. print the remaining human steps: `npm publish` (OTP) + push the tag.
 *
 * Exactly one of --bump / --version is required: the script never guesses a
 * level. Read-only towards Vercel and npm; never prints or stores credentials.
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

export const CLI_PACKAGE = '@lumoai/cli'
export const TAG_PREFIX = 'cli-v'

const PACKAGE_JSON = 'cli/package.json'
const PACKAGE_LOCK = 'package-lock.json'
const GRAMMAR_JSON = 'scripts/cli-grammar/grammar.json'
/** The three committed places that carry the CLI version (LUM-1104 parity). */
export const VERSION_FILES = [PACKAGE_JSON, PACKAGE_LOCK, GRAMMAR_JSON]
export const RELEASE_BRANCH_PREFIX = 'lumo/release-cli-v'
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
  /**
   * Commits reachable from `head` that touched cli/package.json, newest
   * first, with its version.
   */
  packageJsonHistory(head: string): Iterable<{ sha: string; version: string }>
  log(base: string, head: string, paths: string[]): CommitInfo[]
  diffNameStatus(base: string, head: string, paths: string[]): FileChange[]
  createTag(name: string, message: string): void
  /** Creates branch `name` at `startPoint` and switches to it. */
  createBranch(name: string, startPoint: string): void
  /** Stages exactly `paths` and commits them. */
  commit(paths: string[], message: string): void
  /** Pushes `branch` to origin and sets its upstream. */
  push(branch: string): void
}

export interface ReleaseGh {
  /** Opens a pull request; returns its URL. */
  createPr(pr: {
    base: string
    head: string
    title: string
    body: string
  }): string
}

export interface ReleaseWorkspace {
  /**
   * Writes `version` into cli/package.json and package-lock.json, then
   * regenerates grammar.json (emit-grammar) in the working tree.
   */
  setCliVersion(version: string): void
  /** The CLI version each of VERSION_FILES records in the working tree. */
  cliVersions(): Record<string, string | undefined>
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
  gh: ReleaseGh
  workspace: ReleaseWorkspace
  write: (line: string) => void
  writeFile?: (path: string, content: string) => void
  today?: () => string
}

export const BUMP_LEVELS = ['patch', 'minor', 'major'] as const
export type BumpLevel = (typeof BUMP_LEVELS)[number]

export interface ReleaseOptions {
  dryRun: boolean
  fetch: boolean
  since?: string
  changelogOut?: string
  /** Open the release PR that bumps the version by this level. */
  bump?: BumpLevel
  /** Release this version (must equal cli/package.json at HEAD). */
  version?: string
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

/** `version` with `level` applied (lower parts reset to 0). */
export function bumpSemver(version: string, level: BumpLevel): string {
  const p = parseSemver(version)
  if (!p) throw new Error(`not a x.y.z version: ${version}`)
  const [major, minor, patch] = p
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export function maxSemver(versions: string[]): string | null {
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
  for (const entry of git.packageJsonHistory(head)) {
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

/** Changelog from the last release (see resolveBaseline) to `head`. */
function buildChangelog(
  deps: ReleaseDeps,
  head: string,
  published: string[],
  version: string,
  since: string | undefined
): { text: string; baselineLabel: string } | null {
  const { git } = deps
  const baseline = resolveBaseline(git, head, published, since, version)
  if (!baseline) return null
  const grammarBefore = parseJson<GrammarShape>(
    git.showFile(baseline.sha, GRAMMAR_JSON)
  )
  const grammarAfter = parseJson<GrammarShape>(git.showFile(head, GRAMMAR_JSON))
  const text = renderChangelog({
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
  return { text, baselineLabel: baseline.label }
}

const MODE_REQUIRED =
  'choose one: --bump <patch|minor|major> opens the release PR, --version <x.y.z> releases a version main already carries'

/** Runs the release; returns the process exit code. */
export function runRelease(opts: ReleaseOptions, deps: ReleaseDeps): number {
  if (opts.bump && opts.version) {
    deps.write(`✗ ${MODE_REQUIRED} (not both)`)
    return 2
  }
  if (opts.bump) return runBump(opts, opts.bump, deps)
  if (opts.version) return runReleaseChecks(opts, opts.version, deps)
  deps.write(`✗ ${MODE_REQUIRED}`)
  return 2
}

/** Shared step reporter: ok/fail lines + whether the run has failed. */
function stepper(opts: ReleaseOptions, write: (line: string) => void) {
  const state = { failed: false }
  return {
    state,
    ok: (step: string, msg: string) => write(`✓ ${step}: ${msg}`),
    /** Records a failure; returns true when the run must stop now. */
    fail: (step: string, msg: string): boolean => {
      write(`✗ ${step}: ${msg}`)
      state.failed = true
      return !opts.dryRun
    },
  }
}

/**
 * --bump: open the release PR from the latest origin/main. Never merges; the
 * release itself is a later `--version` run once the PR is deployed.
 */
export function runBump(
  opts: ReleaseOptions,
  level: BumpLevel,
  deps: ReleaseDeps
): number {
  const { git, write } = deps
  const { ok, fail, state } = stepper(opts, write)
  write(
    opts.dryRun
      ? `${CLI_PACKAGE} release PR (${level} bump, dry run)`
      : `${CLI_PACKAGE} release PR (${level} bump)`
  )

  // 1. git — the bump commit is made in this checkout, so it must be clean.
  let base: string
  try {
    if (opts.fetch) git.fetchOrigin()
    base = git.revParse('origin/main')
    if (git.statusPorcelain().trim() !== '') {
      if (fail('git', 'working tree is not clean')) return 1
    } else {
      ok('git', `clean; branching from origin/main (${short(base)})`)
    }
  } catch (e) {
    fail('git', errMessage(e))
    return 1
  }

  // 2. version — strictly above both main and npm.
  const mainVersion = parseJson<{ version?: string }>(
    git.showFile(base, PACKAGE_JSON)
  )?.version
  if (!mainVersion || !parseSemver(mainVersion)) {
    fail('version', `cannot read a version from ${PACKAGE_JSON} at origin/main`)
    return 1
  }
  let published: string[]
  try {
    published = deps.npm.publishedVersions(CLI_PACKAGE)
  } catch (e) {
    fail(
      'version',
      `cannot read published versions (${errMessage(e)}) — failing closed`
    )
    return 1
  }
  const npmLatest = maxSemver(published)
  const from =
    npmLatest && compareSemver(npmLatest, mainVersion) > 0
      ? npmLatest
      : mainVersion
  const next = bumpSemver(from, level)
  const tag = `${TAG_PREFIX}${next}`
  const branch = `${RELEASE_BRANCH_PREFIX}${next}`
  ok(
    'version',
    `main ${mainVersion} · npm latest ${npmLatest ?? 'none'} → ${next} (${level})`
  )
  if (
    !published.includes(mainVersion) &&
    compareSemver(mainVersion, npmLatest ?? '0.0.0') > 0
  ) {
    write(
      `  note: main's ${mainVersion} is not on npm yet — to release it as-is, skip the bump: npm run release:cli -- --version ${mainVersion}`
    )
  }
  if (git.listTags(tag).includes(tag)) {
    if (fail('version', `tag ${tag} already exists`)) return 1
  }

  // 3. changelog draft for the PR body
  let changelog: string
  try {
    const built = buildChangelog(deps, base, published, next, opts.since)
    if (!built) {
      fail('changelog', 'no previous release found — pass --since <ref>')
      return 1
    }
    changelog = built.text
    ok('changelog', `draft since ${built.baselineLabel}`)
  } catch (e) {
    fail('changelog', errMessage(e))
    return 1
  }

  const commitMessage = `chore: release CLI v${next} [skip-drift]`
  const title = `chore: release CLI v${next}`
  const body = releasePrBody(next, level, changelog)

  if (opts.dryRun) {
    write('')
    write('Would:')
    write(`  git switch -c ${branch} origin/main`)
    write(`  set ${next} in ${VERSION_FILES.join(', ')} (emit-grammar)`)
    write(`  git commit -m "${commitMessage}"`)
    write(`  git push -u origin ${branch}`)
    write(`  gh pr create --base main --head ${branch} --title "${title}"`)
    write('')
    write('PR body:')
    write(body)
    write(
      state.failed
        ? 'Dry run finished with failing checks — nothing was changed.'
        : 'Dry run OK — nothing was changed.'
    )
    return state.failed ? 1 : 0
  }

  // 4. branch + files + parity
  try {
    git.createBranch(branch, base)
    ok('branch', `created ${branch} at ${short(base)}`)
  } catch (e) {
    fail('branch', errMessage(e))
    return 1
  }
  try {
    deps.workspace.setCliVersion(next)
    const mismatch = Object.entries(deps.workspace.cliVersions())
      .filter(([, v]) => v !== next)
      .map(([where, v]) => `${where} = ${String(v)}`)
    if (mismatch.length > 0) {
      fail(
        'files',
        `versions disagree after the bump (${mismatch.join('; ')}) — left uncommitted on ${branch}`
      )
      return 1
    }
    ok('files', `${VERSION_FILES.join(', ')} at ${next}`)
  } catch (e) {
    fail('files', `${errMessage(e)} — left uncommitted on ${branch}`)
    return 1
  }

  // 5. commit, push, PR
  try {
    git.commit(VERSION_FILES, commitMessage)
    ok('commit', commitMessage)
  } catch (e) {
    fail('commit', `${errMessage(e)} — changes left on ${branch}`)
    return 1
  }
  try {
    git.push(branch)
    ok('push', `origin ${branch}`)
  } catch (e) {
    fail('push', `${errMessage(e)} — the commit is on local ${branch}`)
    return 1
  }
  let url: string
  try {
    url = deps.gh.createPr({ base: 'main', head: branch, title, body })
    ok('pr', url)
  } catch (e) {
    fail(
      'pr',
      `${errMessage(e)} — ${branch} is pushed; open the PR by hand (gh pr create --base main --head ${branch})`
    )
    return 1
  }

  write('')
  write('Stopped here. Next:')
  write(`  1. review and merge ${url}`)
  write('  2. wait until production is deployed from a commit containing it')
  write(
    `  3. git switch main && git pull && npm run release:cli -- --version ${next} --dry-run`
  )
  write(`  4. npm run release:cli -- --version ${next}   (then npm publish)`)
  return 0
}

/** Body of the release PR: what it does, the release steps, the changelog draft. */
export function releasePrBody(
  version: string,
  level: BumpLevel,
  changelog: string
): string {
  return [
    `Release PR for ${CLI_PACKAGE} ${version} (${level} bump), opened by \`npm run release:cli -- --bump ${level}\`.`,
    '',
    `Only the version moves: \`${PACKAGE_JSON}\`, \`${PACKAGE_LOCK}\` (\`packages.cli\`) and \`${GRAMMAR_JSON}\` (\`cliVersion\`, regenerated by emit-grammar).`,
    '',
    '## Release steps after merge',
    '',
    '1. Wait until production is deployed from a commit that contains this PR (new commands call new server APIs).',
    `2. On a clean, up-to-date \`main\`: \`npm run release:cli -- --version ${version} --dry-run\`, then without \`--dry-run\` (tags \`${TAG_PREFIX}${version}\` locally).`,
    `3. \`cd cli && npm publish\` (OTP), then \`git push origin ${TAG_PREFIX}${version}\`.`,
    '',
    'See docs/cli-release.md.',
    '',
    '## Changelog draft',
    '',
    changelog.trimEnd(),
    '',
  ].join('\n')
}

/** --version: the release checks, tag and publish instructions. */
function runReleaseChecks(
  opts: ReleaseOptions,
  expectedVersion: string,
  deps: ReleaseDeps
): number {
  const { git, write } = deps
  const { ok, fail, state } = stepper(opts, write)

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
  if (version !== expectedVersion) {
    if (
      fail(
        'npm',
        `${PACKAGE_JSON} at HEAD is ${version}, not ${expectedVersion} — merge the release PR (npm run release:cli -- --bump <level>) and pull main first`
      )
    )
      return 1
  }
  const tag = `${TAG_PREFIX}${version}`
  let published: string[] = []
  try {
    published = deps.npm.publishedVersions(CLI_PACKAGE)
    const npmLatest = maxSemver(published)
    if (published.includes(version)) {
      if (
        fail(
          'npm',
          `${version} is already published — open a release PR first: npm run release:cli -- --bump <patch|minor|major>`
        )
      )
        return 1
    } else if (npmLatest && compareSemver(version, npmLatest) <= 0) {
      if (
        fail(
          'npm',
          `${version} is not higher than npm's latest ${npmLatest} — open a release PR: npm run release:cli -- --bump <patch|minor|major>`
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
    const built = buildChangelog(deps, head, published, version, opts.since)
    if (!built) {
      fail('changelog', 'no previous release found — pass --since <ref>')
      return 1
    }
    changelog = built.text
    ok('changelog', `since ${built.baselineLabel}`)
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

  if (state.failed) {
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
    packageJsonHistory: function* (head) {
      const shas = git(
        'log',
        '-n',
        '400',
        '--format=%H',
        head,
        '--',
        PACKAGE_JSON
      )
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
    createBranch: (name, startPoint) => {
      git('switch', '--no-track', '-c', name, startPoint)
    },
    commit: (paths, message) => {
      git('add', '--', ...paths)
      git('commit', '-m', message, '--', ...paths)
    },
    push: branch => {
      git('push', '-u', 'origin', branch)
    },
  }
}

export function createGh(cwd: string): ReleaseGh {
  return {
    createPr: ({ base, head, title, body }) => {
      const out = sh(
        'gh',
        [
          'pr',
          'create',
          '--base',
          base,
          '--head',
          head,
          '--title',
          title,
          '--body',
          body,
        ],
        cwd
      )
      const url = out
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .pop()
      if (!url) throw new Error('gh pr create printed no URL')
      return url
    },
  }
}

/** JSON files are written the way npm writes them: 2-space indent + newline. */
const writeJson = (path: string, value: unknown) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

export function createWorkspace(
  cwd: string,
  emitGrammar: () => void = () => {
    sh('npx', ['tsx', 'scripts/cli-grammar/emit-grammar.ts'], cwd)
  }
): ReleaseWorkspace {
  const read = (rel: string) =>
    parseJson<unknown>(readFileSync(join(cwd, rel), 'utf8'))
  return {
    setCliVersion: version => {
      const pkg = read(PACKAGE_JSON) as { version?: string } | null
      if (!pkg) throw new Error(`cannot parse ${PACKAGE_JSON}`)
      const lock = read(PACKAGE_LOCK) as {
        packages?: Record<string, { version?: string }>
      } | null
      const lockCli = lock?.packages?.['cli']
      if (!lock || !lockCli) {
        throw new Error(`${PACKAGE_LOCK} has no packages.cli entry`)
      }
      pkg.version = version
      lockCli.version = version
      writeJson(join(cwd, PACKAGE_JSON), pkg)
      writeJson(join(cwd, PACKAGE_LOCK), lock)
      emitGrammar()
    },
    cliVersions: () => {
      const pkg = read(PACKAGE_JSON) as { version?: string } | null
      const lock = read(PACKAGE_LOCK) as {
        packages?: Record<string, { version?: string }>
      } | null
      const grammar = read(GRAMMAR_JSON) as { cliVersion?: string } | null
      return {
        [PACKAGE_JSON]: pkg?.version,
        [`${PACKAGE_LOCK} packages.cli`]: lock?.packages?.['cli']?.version,
        [`${GRAMMAR_JSON} cliVersion`]: grammar?.cliVersion,
      }
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
    else if (
      a === '--since' ||
      a === '--changelog-out' ||
      a === '--bump' ||
      a === '--version'
    ) {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`missing value for ${a}`)
      }
      i++
      if (a === '--since') opts.since = value
      else if (a === '--changelog-out') opts.changelogOut = value
      else if (a === '--bump') {
        if (!(BUMP_LEVELS as readonly string[]).includes(value)) {
          throw new Error(
            `--bump takes ${BUMP_LEVELS.join(' | ')}, got ${value}`
          )
        }
        opts.bump = value as BumpLevel
      } else {
        if (!parseSemver(value)) {
          throw new Error(`--version takes x.y.z, got ${value}`)
        }
        opts.version = value
      }
    } else if (a === '--help' || a === '-h') return 'help'
    else throw new Error(`unknown argument: ${a}`)
  }
  if (opts.bump && opts.version) {
    throw new Error(`${MODE_REQUIRED} (not both)`)
  }
  if (!opts.bump && !opts.version) throw new Error(MODE_REQUIRED)
  return opts
}

const USAGE = `Usage:
  npm run release:cli -- --bump <patch|minor|major> [--dry-run] [--no-fetch] [--since <ref>]
      open the release PR (version bump) from origin/main, then stop
  npm run release:cli -- --version <x.y.z> [--dry-run] [--no-fetch] [--since <ref>] [--changelog-out <file>]
      after that PR is merged and deployed: release checks, tag, publish steps
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
        gh: createGh(cwd),
        workspace: createWorkspace(cwd),
        write,
      })
    )
  } catch (e) {
    process.stderr.write(`${errMessage(e)}\n${USAGE}\n`)
    process.exit(2)
  }
}
