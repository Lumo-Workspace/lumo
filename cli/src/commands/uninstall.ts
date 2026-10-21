import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { configDir } from '../lib/config'
import { emitConfirmation, isConfirmed } from '../lib/confirmation'
import { removeGitHookBlock } from '../lib/git-hook-template'
import { scanHookFor } from '../lib/scan-hook-template'
import { removeLumoHooks } from '../lib/hooks-template'
import { classifyCodexRules } from '../lib/codex-rules'
import {
  collectDoctor,
  type DoctorDeps,
  type DoctorKind,
  type DoctorRow,
} from './doctor'

/**
 * LUM-1292: `lumo uninstall` removes what `lumo init` wrote into the current
 * git repo (hook entries, the Codex rule, the git hook blocks); `--purge`
 * also empties the Lumo config dir (credentials, caches).
 */
export interface UninstallOptions {
  agent?: string | undefined
  purge?: boolean | undefined
  confirm?: boolean | undefined
}

export interface UninstallDeps extends DoctorDeps {
  /** Raw argv after `lumo`, used to rebuild the confirmCommand. */
  argv?: string[]
}

type ActionKind =
  | 'strip-settings'
  | 'strip-git-hook'
  | 'strip-codex'
  | 'remove-codex-rules'
  | 'strip-scan-hook'

export interface PlannedAction {
  row: DoctorRow
  action: ActionKind
}

export interface UninstallPlan {
  /** The git repo root, or null outside a repo. */
  repo: string | null
  actions: PlannedAction[]
}

const NPM_RM = 'npm rm -g @lumoai/cli'
const COMMITTED_NOTE = 'committed — affects the whole team after you commit'
const CODEX_NOTE =
  'Codex trust entries left in ~/.codex/config.toml are harmless and are not touched'

const ACTION_FOR_KIND: Record<DoctorKind, ActionKind> = {
  'claude-settings': 'strip-settings',
  'git-hook': 'strip-git-hook',
  'codex-hooks': 'strip-codex',
  'codex-rules': 'remove-codex-rules',
  'scan-hook': 'strip-scan-hook',
}

/**
 * What uninstall would touch, derived from the same collector `lumo doctor`
 * uses so the two can never disagree about what is installed. Read-only.
 */
export function planUninstall(
  opts: UninstallOptions,
  deps: UninstallDeps = {}
): UninstallPlan {
  const report = collectDoctor(deps)
  const actions = report.rows
    .filter(row => !opts.agent || row.agent === opts.agent)
    .map(row => ({ row, action: ACTION_FOR_KIND[row.kind] }))
  return { repo: report.repo, actions }
}

function describeAction(a: PlannedAction): string {
  const { row } = a
  const team = row.tracked ? ` ⚠ ${COMMITTED_NOTE}` : ''
  switch (a.action) {
    case 'strip-settings':
      return `Remove the Lumo hook entries from ${row.path}; other settings and hooks are kept${team}`
    case 'strip-git-hook':
    case 'strip-scan-hook':
      return `Remove the Lumo block from ${row.path}; the file is deleted only if nothing else is left${team}`
    case 'strip-codex':
      return `Remove the \`lumo hook\` entries from ${row.path}; the file and other hooks are kept${team}`
    case 'remove-codex-rules':
      return `Delete the Lumo Codex rule ${row.path} (lets \`lumo\` run outside Codex's sandbox)${team}`
  }
}

function describePlan(plan: UninstallPlan, opts: UninstallOptions): string[] {
  const lines = plan.actions.map(describeAction)
  if (plan.actions.length === 0)
    lines.push(`No Lumo hooks in ${plan.repo ?? 'this directory'}`)
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
  if (opts.purge)
    lines.push(
      `--purge: delete everything inside ${configDir()} (credentials, caches); you will need to log in again`
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
    case 'strip-git-hook':
    case 'strip-scan-hook': {
      const begin =
        a.action === 'strip-scan-hook'
          ? scanHookFor(row.path)?.begin
          : undefined
      const { content, changed } = removeGitHookBlock(
        fs.readFileSync(row.path, 'utf8'),
        begin
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
    case 'remove-codex-rules': {
      // Re-checked at apply time: only a file still carrying the Lumo marker.
      const state = classifyCodexRules(row.path)
      if (state !== 'current' && state !== 'outdated')
        return {
          line: `${row.path} is no longer Lumo's Codex rule; left as is`,
          changed: false,
        }
      fs.unlinkSync(row.path)
      try {
        fs.rmdirSync(path.dirname(row.path)) // only succeeds when empty
      } catch {
        // other rules files live there: keep the directory
      }
      return { line: `Deleted Codex rule ${row.path}`, changed: true }
    }
  }
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
  const plan = planUninstall(opts, deps)
  if (!plan.repo && !opts.purge) {
    process.stderr.write(
      'Error: lumo uninstall removes the Lumo hooks of the current repo — run it inside a git repository (or pass --purge to only empty the Lumo config dir).\n'
    )
    return 1
  }

  if (!isConfirmed(opts)) {
    return emitConfirmation({
      command: 'uninstall',
      changes: describePlan(plan, opts),
      ...(deps.argv ? { argv: deps.argv } : {}),
    })
  }

  const out: string[] = []
  let failures = 0
  for (const a of plan.actions) {
    try {
      const applied = applyAction(a)
      out.push(`${applied.changed ? '✓' : '-'} ${applied.line}`)
    } catch (err) {
      failures++
      out.push(
        `✗ ${a.row.path}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  if (opts.purge) {
    try {
      out.push(`✓ ${purgeConfigDir()}`)
    } catch (err) {
      failures++
      out.push(`✗ purge: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (plan.actions.length === 0 && !opts.purge)
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
