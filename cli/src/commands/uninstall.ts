import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { configDir } from '../lib/config'
import { emitConfirmation, isConfirmed } from '../lib/confirmation'
import { removeGitHookBlock } from '../lib/git-hook-template'
import { removeLumoHooks } from '../lib/hooks-template'
import {
  isLumoSkillSource,
  isSkillsLumoPath,
  repoRoot,
} from '../lib/install-locations'
import {
  readRegistryChecked,
  recordAgent,
  removeInstall,
  type InstallKind,
} from '../lib/install-registry'
import {
  collectDoctor,
  type DoctorDeps,
  type DoctorKind,
  type DoctorRow,
} from './doctor'

export type UninstallScope = 'user' | 'project' | 'all'

export interface UninstallOptions {
  scope?: string | undefined
  agent?: string | undefined
  force?: boolean | undefined
  purge?: boolean | undefined
  confirm?: boolean | undefined
}

export interface UninstallDeps extends DoctorDeps {
  /** Raw argv after `lumo`, used to rebuild the confirmCommand. */
  argv?: string[]
}

type ActionKind =
  | 'remove-skill'
  | 'strip-settings'
  | 'strip-git-hook'
  | 'strip-codex'

export interface PlannedAction {
  row: DoctorRow
  action: ActionKind
}

export interface SkippedRow {
  row: DoctorRow
  reason: string
}

export interface StaleRecord {
  kind: InstallKind
  path: string
}

export interface UninstallPlan {
  actions: PlannedAction[]
  skipped: SkippedRow[]
  staleRecords: StaleRecord[]
  registryCorrupt: boolean
}

const NPM_RM = 'npm rm -g @lumoai/cli'
const COMMITTED_NOTE = 'committed — affects the whole team after you commit'
const CODEX_NOTE =
  'Codex trust entries left in ~/.codex/config.toml are harmless and are not touched'

const ACTION_FOR_KIND: Record<DoctorKind, ActionKind> = {
  skill: 'remove-skill',
  'claude-settings': 'strip-settings',
  'git-hook': 'strip-git-hook',
  'codex-hooks': 'strip-codex',
}

function inRepo(root: string | null, p: string): boolean {
  if (!root) return false
  const rel = path.relative(root, p)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function inScope(
  scope: UninstallScope,
  scopeOf: 'user' | 'project',
  otherRepo: boolean
): boolean {
  if (scope === 'all') return true
  if (scope === 'user') return scopeOf === 'user'
  return scopeOf === 'project' && !otherRepo
}

/**
 * What uninstall would touch, derived from the same collector `lumo doctor`
 * uses so the two can never disagree about what is installed. Read-only.
 */
export function planUninstall(
  opts: UninstallOptions,
  deps: UninstallDeps = {}
): UninstallPlan {
  const scope = (opts.scope ?? 'all') as UninstallScope
  const cwd = deps.cwd ?? process.cwd()
  const report = collectDoctor(deps)
  const { registry, corrupt } = readRegistryChecked()
  const actions: PlannedAction[] = []
  const skipped: SkippedRow[] = []

  for (const row of report.rows) {
    if (!inScope(scope, row.scope, row.group === 'other-repos')) continue
    if (opts.agent && row.agent !== opts.agent) continue
    if (row.kind === 'skill' && isLumoSkillSource(row.path)) {
      skipped.push({
        row,
        reason:
          'Lumo skill source (not an install) — never removed, even with --force',
      })
      continue
    }
    if (row.kind === 'skill' && !isSkillsLumoPath(row.path)) {
      skipped.push({
        row,
        reason:
          'not a skills/lumo directory — never removed, even with --force',
      })
      continue
    }
    if (row.kind === 'skill' && row.state === 'modified' && !opts.force) {
      skipped.push({
        row,
        reason: 'edited locally — skipped (pass --force to remove it anyway)',
      })
      continue
    }
    actions.push({ row, action: ACTION_FOR_KIND[row.kind] })
  }

  const root = repoRoot(cwd)
  const staleRecords: StaleRecord[] = []
  for (const rec of registry.installs) {
    if (fs.existsSync(rec.path)) continue
    if (!inScope(scope, rec.scope, !inRepo(root, rec.path))) continue
    if (opts.agent && recordAgent(rec) !== opts.agent) continue
    staleRecords.push({ kind: rec.kind, path: rec.path })
  }
  return { actions, skipped, staleRecords, registryCorrupt: corrupt }
}

function describeAction(a: PlannedAction): string {
  const { row } = a
  const tag = row.group === 'other-repos' ? ' [other repo]' : ''
  const team = row.tracked ? ` ⚠ ${COMMITTED_NOTE}` : ''
  const ver = row.version ? ` v${row.version}` : ''
  switch (a.action) {
    case 'remove-skill':
      return `Delete skill dir ${row.path} (${row.agent}${ver})${tag}${team}`
    case 'strip-settings':
      return `Remove the Lumo hook entries from ${row.path}; other settings and hooks are kept${tag}${team}`
    case 'strip-git-hook':
      return `Remove the Lumo block from ${row.path}; the file is deleted only if nothing else is left${tag}${team}`
    case 'strip-codex':
      return `Remove the \`lumo hook\` entries from ${row.path}; the file and other hooks are kept${team}`
  }
}

function describePlan(plan: UninstallPlan, opts: UninstallOptions): string[] {
  const lines = plan.actions.map(describeAction)
  for (const s of plan.skipped) lines.push(`Skip ${s.row.path}: ${s.reason}`)
  for (const s of plan.staleRecords)
    lines.push(
      `Drop stale registry record for ${s.path} (path no longer exists)`
    )
  if (plan.actions.some(a => a.action === 'strip-codex'))
    lines.push(`Note: ${CODEX_NOTE}`)
  if (
    plan.actions.some(
      a => a.action === 'strip-settings' || a.action === 'strip-codex'
    )
  )
    lines.push(
      'Note: settings/hooks JSON files are rewritten with normalized 2-space formatting (content other than Lumo entries is kept)'
    )
  if (plan.registryCorrupt)
    lines.push(
      opts.purge
        ? 'installs.json is unreadable; --purge deletes it with the rest of the config directory'
        : 'installs.json is unreadable; uninstall works from what it detects and will not rewrite that file (use --purge to delete it)'
    )
  if (opts.purge)
    lines.push(
      `--purge: delete everything inside ${configDir()} (credentials, caches, install registry); you will need to log in again`
    )
  lines.push(
    'Nothing is committed; git-tracked changes are left for you to review and commit'
  )
  return lines
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

function readJsonObject(file: string): Record<string, unknown> {
  const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('not a JSON object')
  return v as Record<string, unknown>
}

/** Result of one applied action; `changed: false` means nothing was touched. */
interface Applied {
  line: string
  changed: boolean
}

function applyAction(a: PlannedAction): Applied {
  const { row } = a
  switch (a.action) {
    case 'remove-skill':
      fs.rmSync(row.path, { recursive: true, force: true })
      return { line: `Deleted skill dir ${row.path}`, changed: true }
    case 'strip-settings': {
      const { result, removed } = removeLumoHooks(
        readJsonObject(row.path) as never
      )
      if (removed === 0)
        return { line: `No Lumo hook entries in ${row.path}`, changed: false }
      writeJson(row.path, result)
      return {
        line: `Removed ${removed} Lumo hook entr${removed === 1 ? 'y' : 'ies'} from ${row.path}`,
        changed: true,
      }
    }
    case 'strip-git-hook': {
      const { content, changed } = removeGitHookBlock(
        fs.readFileSync(row.path, 'utf8')
      )
      if (!changed)
        return {
          line: `No complete Lumo block in ${row.path}; left as is`,
          changed: false,
        }
      if (content === null) {
        fs.unlinkSync(row.path)
        return {
          line: `Deleted ${row.path} (only the Lumo block was in it)`,
          changed: true,
        }
      }
      fs.writeFileSync(row.path, content)
      return { line: `Removed the Lumo block from ${row.path}`, changed: true }
    }
    case 'strip-codex': {
      const data = readJsonObject(row.path)
      const nested = data.hooks !== null && typeof data.hooks === 'object'
      const { result, removed } = removeLumoHooks(
        data as never,
        (_event, c) => c.startsWith('lumo hook '),
        !nested
      )
      if (removed === 0)
        return {
          line: `No \`lumo hook\` entries in ${row.path}`,
          changed: false,
        }
      writeJson(row.path, result)
      return {
        line: `Removed ${removed} \`lumo hook\` entr${removed === 1 ? 'y' : 'ies'} from ${row.path}`,
        changed: true,
      }
    }
  }
}

const REGISTRY_KIND: Record<ActionKind, InstallKind | null> = {
  'remove-skill': 'skill',
  'strip-settings': 'claude-settings',
  'strip-git-hook': 'git-hook',
  'strip-codex': null,
}

/** Empty configDir() without removing the directory itself where possible. */
function purgeConfigDir(): string {
  const dir = path.resolve(configDir())
  if (dir === path.parse(dir).root || dir === path.resolve(os.homedir()))
    throw new Error(`refusing to purge ${dir}`)
  if (!fs.existsSync(dir)) return `Nothing to purge in ${dir}`
  for (const entry of fs.readdirSync(dir))
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true })
  try {
    fs.rmdirSync(dir)
  } catch {
    // keep the (now empty) directory if it cannot be removed
  }
  return `Purged ${dir}`
}

/** `lumo uninstall`: remove what `lumo init` installed. Exit 4 until --confirm. */
export async function uninstall(
  opts: UninstallOptions = {},
  deps: UninstallDeps = {}
): Promise<number> {
  const scope = opts.scope ?? 'all'
  if (!['user', 'project', 'all'].includes(scope)) {
    process.stderr.write(
      `Error: --scope must be user, project or all (got "${scope}")\n`
    )
    return 1
  }
  if (opts.purge && scope !== 'all') {
    process.stderr.write(
      `Error: --purge empties the whole Lumo config directory, so it cannot be combined with --scope ${scope}; use --scope all (the default).\n`
    )
    return 1
  }
  const plan = planUninstall(opts, deps)

  if (!isConfirmed(opts)) {
    return emitConfirmation({
      command: 'uninstall',
      changes: describePlan(plan, opts),
      ...(deps.argv ? { argv: deps.argv } : {}),
    })
  }

  const out: string[] = []
  let failures = 0
  const fail = (what: string, err: unknown): void => {
    failures++
    out.push(`✗ ${what}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // A corrupt installs.json is never rewritten — --purge deletes it instead.
  const touchRegistry = !plan.registryCorrupt && !opts.purge

  for (const a of plan.actions) {
    try {
      const applied = applyAction(a)
      if (!applied.changed) {
        out.push(`- ${applied.line}`)
        continue
      }
      out.push(`✓ ${applied.line}`)
    } catch (err) {
      fail(a.row.path, err)
      continue
    }
    const kind = REGISTRY_KIND[a.action]
    if (touchRegistry && kind) {
      try {
        removeInstall(kind, a.row.path)
      } catch (err) {
        fail(`registry record for ${a.row.path}`, err)
      }
    }
  }
  for (const s of plan.staleRecords) {
    if (!touchRegistry) continue
    try {
      removeInstall(s.kind, s.path)
      out.push(`✓ Dropped stale registry record for ${s.path}`)
    } catch (err) {
      fail(`registry record for ${s.path}`, err)
    }
  }
  for (const s of plan.skipped) out.push(`- Skipped ${s.row.path}: ${s.reason}`)
  if (opts.purge) {
    try {
      out.push(`✓ ${purgeConfigDir()}`)
    } catch (err) {
      fail('purge', err)
    }
  }
  if (plan.actions.length === 0 && !opts.purge && failures === 0)
    out.push('Nothing to uninstall.')
  if (plan.actions.some(a => a.action === 'strip-codex'))
    out.push(`Note: ${CODEX_NOTE}.`)
  out.push(
    '',
    'Nothing was committed. Final manual step, to remove the CLI itself:',
    `  ${NPM_RM}`
  )
  process.stdout.write(out.join('\n') + '\n')
  return failures > 0 ? 1 : 0
}
