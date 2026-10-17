import { EXIT_USAGE } from '../lib/exit-codes'
import { stringifyJson, withVersion } from '../lib/json-output'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ENUM_TO_TOKEN, normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'
import { readCliVersion } from '../lib/cli-version'
import { bundledSkillDir, copySkillTree } from '../lib/codex-plugin'
import { upsertInstall, writeMarker } from '../lib/install-registry'
import { isSkillsLumoPath } from '../lib/install-locations'
import { isNewerVersion } from '../lib/install-state'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { hashSkillDir } from '../lib/skill-hash'
import {
  collectSkillCopies,
  currentRepoSkillPaths,
  diffSkillDirs,
  displayPath,
  filesWord,
  formatSkillChangeLine,
  isOtherRepoCopy,
  skillCopyRepoRoot,
  skillCopyStatus,
  SKILL_STATUS_SCHEMA_VERSION,
  type SkillCopyStatus,
  type SkillStatusJson,
} from '../lib/skill-copies'
import { icons } from '../lib/ui'

/**
 * LUM-1107 — `lumo skill status` / `lumo skill update`: report and refresh
 * only the Lumo skill copies. Unlike re-running `lumo init` nothing else is
 * touched: no Claude settings hooks, no Codex hooks.json / rules, no git
 * hook. Safety rules match init/auto-sync: only `…/skills/lumo` dirs are
 * written, never a downgrade, locally modified copies only with `--force`,
 * the Lumo source repo's `.claude/skills/lumo` never, git-tracked copies are
 * changed but never committed.
 *
 * LUM-1122 — `skill update` writes only user copies and the copies in the
 * current repo (git toplevel of cwd). Copies the install registry records in
 * other repos are listed by `skill status` and skipped by `skill update` with
 * a "run it in that repo" hint, whatever the scope flags or --force.
 */

/** Test seams: everything defaults to the real environment. */
export type SkillDeps = {
  cliVersion?: string | null
  homeDir?: string
  cwd?: string
  bundledSkillDir?: string
  out?: (s: string) => void
  err?: (s: string) => void
  render?: ListRenderOptions
}

type Env = {
  cliVersion: string
  homeDir: string
  cwd: string
  out: (s: string) => void
  err: (s: string) => void
}

function resolveEnv(deps: SkillDeps): Env | null {
  const err = deps.err ?? ((s: string) => void process.stderr.write(s))
  const cliVersion =
    deps.cliVersion === undefined ? readCliVersion() : deps.cliVersion
  if (!cliVersion) {
    err(
      'Error: could not determine the @lumoai/cli version — reinstall @lumoai/cli.\n'
    )
    return null
  }
  return {
    cliVersion,
    homeDir: deps.homeDir ?? os.homedir(),
    cwd: deps.cwd ?? process.cwd(),
    out: deps.out ?? ((s: string) => void process.stdout.write(s)),
    err,
  }
}

const STATE_LABEL: Record<SkillCopyStatus['state'], string> = {
  'up-to-date': 'up to date',
  behind: 'behind CLI',
  newer: 'newer than CLI',
  modified: 'modified',
  source: 'source',
}

/** Sorted user-first, then by path — stable for both output modes. */
function sortCopies<T extends { scope: string; path: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) =>
    a.scope === b.scope
      ? a.path.localeCompare(b.path)
      : a.scope === 'user'
        ? -1
        : 1
  )
}

// ── skill status ───────────────────────────────────────────────────────────

export function buildSkillStatus(
  cliVersion: string,
  homeDir: string,
  cwd: string
): SkillStatusJson {
  const skills = sortCopies(collectSkillCopies({ homeDir, cwd })).map(l =>
    skillCopyStatus(l, cliVersion)
  )
  return { schemaVersion: SKILL_STATUS_SCHEMA_VERSION, cliVersion, skills }
}

export async function skillStatus(
  options: { json?: boolean },
  deps: SkillDeps = {}
): Promise<number> {
  const env = resolveEnv(deps)
  if (!env) return 1
  const status = buildSkillStatus(env.cliVersion, env.homeDir, env.cwd)
  if (options.json) {
    env.out(stringifyJson(withVersion(status)))
    return 0
  }
  env.out(`Lumo skill copies (CLI ${env.cliVersion})\n\n`)
  if (status.skills.length === 0) {
    env.out('No Lumo skill copies found. Run `lumo init` to install.\n')
    return 0
  }
  const rows = status.skills.map(s => [
    displayPath(s.path, env.homeDir),
    s.scope,
    s.agent,
    s.version ?? '-',
    STATE_LABEL[s.state],
    s.gitTracked ? 'tracked' : '-',
  ])
  env.out(
    renderListTable(rows, {
      header: ['PATH', 'SCOPE', 'AGENT', 'VERSION', 'STATE', 'GIT'],
      ...deps.render,
    }) + '\n'
  )
  const here = currentRepoSkillPaths(env.cwd)
  const local = status.skills.filter(s => !isOtherRepoCopy(s, here))
  const elsewhere = status.skills.length - local.length
  const behind = local.filter(s => s.state === 'behind').length
  const modified = local.filter(s => s.state === 'modified').length
  if (behind + modified + elsewhere > 0) env.out('\n')
  if (behind > 0)
    env.out(
      `${behind} behind the CLI — run \`lumo skill update\` (preview with --dry-run).\n`
    )
  if (modified > 0)
    env.out(
      `${modified} modified locally — \`lumo skill update --force\` overwrites (discards the edits).\n`
    )
  if (elsewhere > 0)
    env.out(
      `${elsewhere} in other repos — \`lumo skill update\` only writes the current repo; run it in that repo.\n`
    )
  return 0
}

/** POSIX-quote a path for a copy-pasteable hint; plain paths stay bare. */
export function shellQuote(p: string): string {
  return /^[\w@%+=:,./~-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`
}

// ── skill update ───────────────────────────────────────────────────────────

export type SkillUpdateOptions = {
  user?: boolean
  project?: boolean
  agent?: string
  dryRun?: boolean
  force?: boolean
}

export type SkillUpdateResult =
  | 'updated'
  | 'up-to-date'
  | 'skipped-modified'
  | 'skipped-newer'
  | 'skipped-source'
  | 'skipped-not-skills-lumo'

/**
 * Plan and (unless `dryRun`) apply the refresh of one copy. Returns the
 * outcome; prints one heading line per copy plus the file list when it
 * changes.
 */
export function updateSkillCopy(
  copy: SkillCopyStatus,
  bundled: string,
  opts: { cliVersion: string; force: boolean; dryRun: boolean; home: string },
  out: (s: string) => void
): SkillUpdateResult {
  const shown = displayPath(copy.path, opts.home)
  if (!isSkillsLumoPath(copy.path)) {
    out(`${icons.warning} skipped ${shown}: not a skills/lumo directory\n`)
    return 'skipped-not-skills-lumo'
  }
  if (copy.state === 'source') {
    out(`· ${shown}: Lumo skill source (not an install) — left untouched\n`)
    return 'skipped-source'
  }
  // No downgrade, ever: a modified copy whose marker says it came from a newer
  // CLI is refused too, even with --force.
  const newer =
    copy.state === 'newer' ||
    (copy.state === 'modified' &&
      copy.version !== null &&
      isNewerVersion(opts.cliVersion, copy.version))
  if (newer) {
    out(
      `${icons.warning} skipped ${shown}: ${copy.version} is newer than this CLI (${opts.cliVersion}) — run \`lumo update\`\n`
    )
    return 'skipped-newer'
  }
  if (copy.state === 'modified' && !opts.force) {
    out(
      `${icons.warning} skipped ${shown}: modified locally — re-run with --force to overwrite (discards the edits)\n`
    )
    return 'skipped-modified'
  }
  const changes = diffSkillDirs(bundled, copy.path)
  if (copy.state === 'up-to-date' && changes.length === 0) {
    out(`· ${shown}: up to date (${copy.version})\n`)
    return 'up-to-date'
  }
  if (copy.state === 'up-to-date' && !opts.force) {
    // Same version, different bytes (a dev build): like init, not rewritten.
    out(`· ${shown}: up to date (${copy.version})\n`)
    return 'up-to-date'
  }
  const from = copy.version ?? 'unknown'
  const verb = opts.dryRun ? 'would update' : `${icons.success} updated`
  out(
    `${verb} ${shown} (${from} → ${opts.cliVersion}): ${filesWord(changes.length)} changed\n`
  )
  for (const c of changes) out(formatSkillChangeLine(c))
  if (!opts.dryRun) {
    copySkillTree(bundled, copy.path)
    const hash = hashSkillDir(copy.path)
    const installedAt = new Date().toISOString()
    writeMarker(copy.path, {
      version: opts.cliVersion,
      hash,
      agent: copy.agent,
      installedAt,
    })
    upsertInstall({
      kind: 'skill',
      path: copy.path,
      scope: copy.scope,
      agent: copy.agent,
      version: opts.cliVersion,
      hash,
      installedAt,
    })
  }
  if (copy.gitTracked)
    out(
      opts.dryRun
        ? `    ℹ tracked by git — the update would leave ${filesWord(changes.length)} changed for you to commit in a PR\n`
        : `    ℹ tracked by git — modified ${filesWord(changes.length)} (plus the .lumo-install.json marker); not committed — open a PR to commit them\n`
    )
  return 'updated'
}

export async function skillUpdate(
  options: SkillUpdateOptions,
  deps: SkillDeps = {}
): Promise<number> {
  const err = deps.err ?? ((s: string) => void process.stderr.write(s))
  if (options.user && options.project) {
    err('Error: --user and --project are mutually exclusive.\n')
    return EXIT_USAGE
  }
  let agent: string | undefined
  if (options.agent !== undefined) {
    const e = normalizeAgent(options.agent)
    if (!e) {
      err(
        `Error: Unknown agent "${options.agent}". Valid agents: ${VALID_AGENT_TOKENS.join(', ')}.\n`
      )
      return EXIT_USAGE
    }
    agent = ENUM_TO_TOKEN[e]
  }
  const env = resolveEnv(deps)
  if (!env) return 1
  const bundled = deps.bundledSkillDir ?? bundledSkillDir()
  if (!fs.existsSync(path.join(bundled, 'SKILL.md'))) {
    err(
      `Error: bundled skill asset missing at ${bundled} — reinstall @lumoai/cli.\n`
    )
    return 1
  }
  const scope = options.user ? 'user' : options.project ? 'project' : undefined
  const dryRun = options.dryRun === true
  const found = sortCopies(
    collectSkillCopies({
      homeDir: env.homeDir,
      cwd: env.cwd,
      ...(scope ? { scope } : {}),
      ...(agent ? { agent } : {}),
    })
  )
  env.out(
    dryRun
      ? `Lumo skill update — dry run, nothing is written (CLI ${env.cliVersion})\n\n`
      : `Updating Lumo skill copies (CLI ${env.cliVersion})\n\n`
  )
  if (found.length === 0) {
    env.out('No Lumo skill copies found. Run `lumo init` to install.\n')
    return 0
  }
  // Only the user copies and the current repo's copies are written; a copy
  // the registry records in another repo is that repo's to update.
  const here = currentRepoSkillPaths(env.cwd)
  const copies = found.filter(l => !isOtherRepoCopy(l, here))
  for (const l of found) {
    if (!isOtherRepoCopy(l, here)) continue
    env.out(
      `· ${displayPath(l.path, env.homeDir)}: in another repo — not written; run \`cd ${shellQuote(skillCopyRepoRoot(l.path))} && lumo skill update --project\` there\n`
    )
  }
  if (copies.length === 0) {
    env.out(
      `\nNothing to update in this repo — every copy found belongs to another repo (run \`lumo skill update\` there).\n`
    )
    return 0
  }
  let failures = 0
  let updated = 0
  for (const loc of copies) {
    try {
      const res = updateSkillCopy(
        skillCopyStatus(loc, env.cliVersion),
        bundled,
        {
          cliVersion: env.cliVersion,
          force: options.force === true,
          dryRun,
          home: env.homeDir,
        },
        env.out
      )
      if (res === 'updated') updated++
    } catch (e) {
      failures++
      const msg = e instanceof Error ? e.message : String(e)
      env.err(`${icons.error} ${loc.path}: ${msg}\n`)
    }
  }
  env.out(
    dryRun
      ? `\n${updated} of ${copies.length} would be updated. Hooks, settings, Codex hooks/rules and the git hook are never touched — re-running \`lumo init\` refreshes those.\n`
      : `\n${updated} of ${copies.length} updated. Hooks, settings, Codex hooks/rules and the git hook were not touched — re-running \`lumo init\` refreshes those.\n`
  )
  return failures > 0 ? 1 : 0
}
