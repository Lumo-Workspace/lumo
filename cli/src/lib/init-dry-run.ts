import * as fs from 'fs'
import * as path from 'path'
import { codexHooksPath, codexTrustInstructions } from './codex-hooks'
import {
  classifyCodexRules,
  codexRulesPath,
  LUMO_CODEX_RULES,
} from './codex-rules'
import {
  LUMO_HOOK_END,
  PREPARE_COMMIT_MSG_HOOK,
  type GitHookSpec,
} from './git-hook-template'
import { SCAN_HOOKS } from './scan-hook-template'
import { CODEX_HOOK_EVENTS } from './hooks-template'
import {
  planGitHookInstall,
  planHooksMerge,
  type HooksMergePlan,
} from './install-plan'
import { isPathGitTracked } from './repo-root'
import {
  classifySkillStub,
  LUMO_SKILL_STUB,
  skillStubPaths,
} from './skill-stub'
import { icons } from './ui'
import { formatUnifiedDiff } from './unified-diff'

/**
 * LUM-1113 / LUM-1118 — `lumo init --dry-run`: for every file `lumo init`
 * would visit in the current repo (and `--agent`), what it would do (path,
 * action, unified diff) and whether Codex would ask to trust its hooks. The
 * decisions come from `install-plan` — the same functions the real run acts
 * on — and nothing here writes a file.
 *
 * JSON hook files are diffed on a normalized view that keeps only Lumo's
 * `lumo hook …` entries; everything else in the file is folded to a count so
 * the preview never prints the user's other settings. A prepare-commit-msg
 * shows only its Lumo block.
 */

export type InitItemKind =
  | 'claude-settings'
  | 'codex-hooks'
  | 'codex-rules'
  | 'skill-stub'
  | 'git-hook'
  | 'scan-hook'

/**
 * - `install`: a new file would be written;
 * - `update`: the file would be rewritten;
 * - `unchanged`: nothing to do;
 * - `skip`: left alone on purpose (not Lumo's, a custom hooks dir);
 * - `error`: cannot be planned (unparseable JSON, …) — the real run fails it too.
 */
export type InitAction = 'install' | 'update' | 'unchanged' | 'skip' | 'error'

export interface InitItem {
  kind: InitItemKind
  path: string
  action: InitAction
  /** What is (or is not) done, after the path. */
  summary: string
  /** Extra lines (re-trust, git tracking, folded content). */
  notes: string[]
  /** Unified diffs, one per changed file ('' parts omitted). */
  diffs: string[]
  /** Codex will ask to trust these hooks (again). */
  retrust: boolean
  /** Overrides the kind's label (a scan hook names its git hook). */
  label?: string
}

const KIND_LABEL: Record<InitItemKind, string> = {
  'claude-settings': 'Claude settings hooks',
  'codex-hooks': 'Codex hooks',
  'codex-rules': 'Codex rule',
  'skill-stub': 'Lumo skill stub',
  'git-hook': 'prepare-commit-msg hook',
  'scan-hook': 'scan hook',
}

// ── normalized hook-file view ──────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isLumoHook(h: unknown): h is { type?: unknown; command: string } {
  return (
    isObject(h) &&
    typeof h.command === 'string' &&
    h.command.startsWith('lumo hook ')
  )
}

const plural = (n: number, word: string): string =>
  `${n} other ${word}${n === 1 ? '' : 's'}`

/**
 * The Lumo-managed part of a Claude settings / Codex hooks file as stable
 * pretty JSON: events sorted, only `lumo hook …` entries (and the matcher of
 * their group) kept, every other
 * hook, group, event and top-level setting folded to a count.
 */
export function lumoHooksView(content: unknown): string {
  const root = isObject(content) ? content : {}
  const view: Record<string, unknown> = {}
  const hooks = isObject(root.hooks) ? root.hooks : null
  if (hooks) {
    const events: Record<string, unknown> = {}
    let otherEvents = 0
    for (const event of Object.keys(hooks).sort()) {
      const groups = hooks[event]
      const items: unknown[] = []
      let otherGroups = 0
      for (const g of Array.isArray(groups) ? groups : []) {
        const list = isObject(g) && Array.isArray(g.hooks) ? g.hooks : []
        const ours = list.filter(isLumoHook)
        if (ours.length === 0) {
          otherGroups++
          continue
        }
        const entries: unknown[] = ours.map(h => ({
          type: h.type,
          command: h.command,
        }))
        const others = list.length - ours.length
        if (others > 0) entries.push(`… ${plural(others, 'hook')}`)
        // A matcher on a group holding a Lumo hook decides when that hook
        // fires, so it is shown; groups without a Lumo hook stay folded.
        items.push(
          isObject(g) && g.matcher !== undefined
            ? { matcher: g.matcher, hooks: entries }
            : { hooks: entries }
        )
      }
      if (items.length === 0) {
        otherEvents++
        continue
      }
      if (otherGroups > 0) items.push(`… ${plural(otherGroups, 'hook group')}`)
      events[event] = items
    }
    if (otherEvents > 0) events['…'] = plural(otherEvents, 'event')
    view.hooks = events
  } else if (root.hooks !== undefined) {
    view.hooks = '… not Lumo-shaped'
  }
  const otherKeys = Object.keys(root).filter(k => k !== 'hooks').length
  if (otherKeys > 0) view['…'] = plural(otherKeys, 'setting')
  return JSON.stringify(view, null, 2) + '\n'
}

// ── planning ───────────────────────────────────────────────────────────────

const GIT_NOTE =
  'ℹ tracked by git — the change would show up in `git diff` for you to commit'

/** `file` relative to the repo root when inside it, else as given. */
export function displayPath(file: string, root: string): string {
  const rel = path.relative(root, file)
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? file : rel
}

/** Lines of a text without the final newline's empty tail. */
function textLines(text: string): string[] {
  if (text === '') return []
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
}

/**
 * Unified diff of two texts; a missing side ('') renders as a whole-file
 * add/delete hunk. Texts that differ only in the final newline say so
 * instead of printing an empty diff.
 */
export function textDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string
): string {
  const a = textLines(oldText)
  const b = textLines(newText)
  if (a.length === 0 || b.length === 0) {
    if (a.length === 0 && b.length === 0) return ''
    const head = `--- ${oldLabel}\n+++ ${newLabel}\n`
    return a.length === 0
      ? `${head}@@ -0,0 +1${b.length === 1 ? '' : `,${b.length}`} @@\n${b.map(l => `+${l}`).join('\n')}`
      : `${head}@@ -1${a.length === 1 ? '' : `,${a.length}`} +0,0 @@\n${a.map(l => `-${l}`).join('\n')}`
  }
  const diff = formatUnifiedDiff(a.join('\n'), b.join('\n'), oldLabel, newLabel)
  if (diff === '' && oldText !== newText)
    return `--- ${oldLabel}\n+++ ${newLabel}\n(only the final newline differs)`
  return diff
}

function readOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function hooksItem(
  kind: 'claude-settings' | 'codex-hooks',
  file: string,
  plan: HooksMergePlan,
  agent: string,
  root: string
): InitItem {
  const { addedEvents, updatedEvents, removedEvents } = plan.stats
  const label = kind === 'codex-hooks' ? '' : ` (agent=${agent})`
  if (!plan.writes) {
    return {
      kind,
      path: file,
      action: 'unchanged',
      summary: `up to date${label}`,
      notes: [],
      diffs: [],
      retrust: false,
    }
  }
  const notes: string[] = plan.exists
    ? [
        'ℹ only Lumo\'s `lumo hook …` entries are shown; other settings are folded ("… N other …") and kept as they are',
      ]
    : []
  if (
    plan.raw !== null &&
    plan.raw !== JSON.stringify(plan.existing, null, 2) + '\n'
  )
    notes.push('ℹ the file is also re-formatted as 2-space JSON')
  const retrust = kind === 'codex-hooks'
  if (retrust) {
    const events = [
      ...addedEvents.map(e => `${e} (added)`),
      ...updatedEvents.map(e => `${e} (updated)`),
    ]
    // Only a file already holding Lumo entries is *re*-trusted; a new file
    // or one with only the user's hooks needs a first trust.
    const hadLumo =
      plan.stats.alreadyPresent.length + plan.stats.updatedEvents.length > 0
    notes.push(
      hadLumo
        ? `${icons.warning} Codex will ask to trust these hooks again — events: ${events.join(', ')}`
        : `${icons.warning} Codex runs these hooks only after you trust them — events: ${events.join(', ')}`,
      ...codexTrustInstructions(file)
        .split('\n')
        .slice(1)
        .map(l => l.trim())
    )
  }
  if (plan.exists && isPathGitTracked(file)) notes.push(GIT_NOTE)
  return {
    kind,
    path: file,
    action: plan.exists ? 'update' : 'install',
    summary: `add ${addedEvents.length}, update ${updatedEvents.length} Lumo event${addedEvents.length + updatedEvents.length === 1 ? '' : 's'}${removedEvents.length > 0 ? `, remove ${removedEvents.length} retired (${removedEvents.join(', ')})` : ''}${label}`,
    notes,
    diffs: [
      textDiff(
        lumoHooksView(plan.existing),
        lumoHooksView(plan.merged),
        `${displayPath(file, root)} (now, Lumo entries)`,
        `${displayPath(file, root)} (after, Lumo entries)`
      ),
    ].filter(Boolean),
    retrust,
  }
}

function codexRulesItem(file: string): InitItem {
  const base = { kind: 'codex-rules' as const, path: file, retrust: false }
  const state = classifyCodexRules(file)
  if (state === 'foreign')
    return {
      ...base,
      action: 'skip',
      summary:
        "not written by Lumo — left as is (move it aside and re-run `lumo init` to use Lumo's rule)",
      notes: [],
      diffs: [],
    }
  if (state === 'current')
    return {
      ...base,
      action: 'unchanged',
      summary: 'up to date',
      notes: [],
      diffs: [],
    }
  const notes = ['ℹ restart Codex to load the new rule']
  if (state !== 'missing' && isPathGitTracked(file)) notes.push(GIT_NOTE)
  return {
    ...base,
    action: state === 'missing' ? 'install' : 'update',
    summary:
      state === 'missing'
        ? "Lumo's rules: run `lumo` outside the sandbox, ask before local-writing commands"
        : 'Lumo-managed file differs from this CLI — rewritten',
    notes,
    diffs:
      state === 'missing'
        ? []
        : [
            textDiff(
              readOrEmpty(file),
              LUMO_CODEX_RULES,
              `a/${path.basename(file)}`,
              `b/${path.basename(file)}`
            ),
          ].filter(Boolean),
  }
}

function skillStubItem(file: string): InitItem {
  const base = { kind: 'skill-stub' as const, path: file, retrust: false }
  const state = classifySkillStub(file)
  if (state === 'current')
    return {
      ...base,
      action: 'unchanged',
      summary: 'up to date',
      notes: [],
      diffs: [],
    }
  if (state === 'missing')
    return {
      ...base,
      action: 'install',
      summary: 'frozen pointer to `lumo skill read` (gives the agent /lumo)',
      notes: [],
      diffs: [],
    }
  return {
    ...base,
    action: 'update',
    summary: 'differs from the Lumo stub — overwritten',
    notes: isPathGitTracked(file) ? [GIT_NOTE] : [],
    diffs: [
      textDiff(
        readOrEmpty(file),
        LUMO_SKILL_STUB,
        `${path.basename(path.dirname(file))}/SKILL.md (now)`,
        `${path.basename(path.dirname(file))}/SKILL.md (after)`
      ),
    ].filter(Boolean),
  }
}

/** The Lumo block of a hook file ('' when its end marker is missing). */
function lumoBlock(text: string, beginMarker: string): string {
  const begin = text.indexOf(beginMarker)
  const end = begin === -1 ? -1 : text.indexOf(LUMO_HOOK_END, begin)
  return end === -1 ? '' : text.slice(begin, end + LUMO_HOOK_END.length) + '\n'
}

function gitHookItem(
  root: string,
  spec: GitHookSpec = PREPARE_COMMIT_MSG_HOOK,
  kind: 'git-hook' | 'scan-hook' = 'git-hook'
): InitItem {
  const plan = planGitHookInstall(root, spec)
  const base = {
    kind,
    retrust: false,
    diffs: [],
    ...(kind === 'scan-hook' ? { label: `${spec.hook} scan hook` } : {}),
  }
  switch (plan.status) {
    case 'not-repo':
      return {
        ...base,
        path: root,
        action: 'skip',
        summary: 'not a git repository — no git hook (folder install)',
        notes: [],
      }
    case 'degrade':
      return {
        ...base,
        path: plan.coreHooksPath,
        action: 'skip',
        summary: `core.hooksPath is set (husky or a custom dir) — never written; \`lumo init${kind === 'scan-hook' ? ' --scan-hooks' : ''}\` prints the block to add by hand`,
        notes: [],
      }
    case 'no-dir':
      return {
        ...base,
        path: root,
        action: 'skip',
        summary: 'could not resolve the git hooks dir',
        notes: [],
      }
    case 'unchanged':
      return {
        ...base,
        path: plan.hookPath,
        action: 'unchanged',
        summary: 'up to date',
        notes: [],
      }
  }
  const file = plan.hookPath
  const label = displayPath(file, root)
  if (plan.status === 'created')
    return {
      ...base,
      path: file,
      action: 'install',
      summary: 'new hook with the Lumo block',
      notes: [],
    }
  const old =
    plan.status === 'updated' ? lumoBlock(plan.existing ?? '', spec.begin) : ''
  return {
    ...base,
    path: file,
    action: 'update',
    summary:
      plan.status === 'appended'
        ? (plan.existing ?? '').includes(spec.begin)
          ? 'Lumo block has no end marker — a fresh block is appended'
          : 'Lumo block appended; the existing hook is kept'
        : 'Lumo block replaced',
    notes: [
      'ℹ only the Lumo block is shown; the rest of the hook is kept as is',
    ],
    diffs: [
      textDiff(
        old,
        `${spec.block}\n`,
        `${label} (now, Lumo block)`,
        `${label} (after, Lumo block)`
      ),
    ].filter(Boolean),
  }
}

function errorItem(kind: InitItemKind, file: string, err: unknown): InitItem {
  return {
    kind,
    path: file,
    action: 'error',
    summary: err instanceof Error ? err.message : String(err),
    notes: [],
    diffs: [],
    retrust: false,
  }
}

/**
 * Plan every file `lumo init` would visit in the repo at `root` for the agent
 * `tokens`, in the order it runs. Writes nothing.
 */
export function planInit(args: {
  tokens: readonly string[]
  /** The install root: the git repo root, or the folder (Task 11). */
  root: string
  /** LUM-1258: `--scan-hooks` — also plan the pre-commit / pre-push scan hooks. */
  scanHooks?: boolean
}): InitItem[] {
  const items: InitItem[] = []
  const attempt = (kind: InitItemKind, file: string, fn: () => InitItem) => {
    try {
      items.push(fn())
    } catch (err) {
      items.push(errorItem(kind, file, err))
    }
  }
  for (const token of args.tokens) {
    if (token === 'codex') {
      const hooks = codexHooksPath(args.root)
      attempt('codex-hooks', hooks, () =>
        hooksItem(
          'codex-hooks',
          hooks,
          planHooksMerge(hooks, 'codex', CODEX_HOOK_EVENTS),
          'codex',
          args.root
        )
      )
      const rules = codexRulesPath(args.root)
      attempt('codex-rules', rules, () => codexRulesItem(rules))
    } else {
      const settings = path.join(args.root, '.claude', 'settings.json')
      attempt('claude-settings', settings, () =>
        hooksItem(
          'claude-settings',
          settings,
          planHooksMerge(settings, token),
          token,
          args.root
        )
      )
    }
    for (const stub of skillStubPaths(args.root, [token]))
      attempt('skill-stub', stub, () => skillStubItem(stub))
  }
  attempt('git-hook', args.root, () => gitHookItem(args.root))
  if (args.scanHooks)
    for (const spec of SCAN_HOOKS)
      attempt('scan-hook', args.root, () =>
        gitHookItem(args.root, spec, 'scan-hook')
      )
  return items
}

/** The `lumo init …` command that applies a dry run with the same flags. */
export function initApplyCommand(opts: {
  agent?: string
  scanHooks?: boolean
}): string {
  let cmd = 'lumo init'
  if (opts.agent !== undefined) cmd += ` --agent ${opts.agent}`
  if (opts.scanHooks) cmd += ' --scan-hooks'
  return cmd
}

/** Task 11: the warnings shown before a folder (non-git) install. */
export function folderWarnings(root: string): string[] {
  return [
    `${icons.warning} ${root} is not a git repository — these files can't be shared with teammates via git.`,
    `${icons.warning} They apply only to agent sessions started in this folder (a project inside it that has its own \`lumo init\` uses that install instead).`,
  ]
}

/** Task 11: the files a folder install would write (changing items only). */
export function renderFolderPlan(
  items: readonly InitItem[],
  root: string
): string {
  const lines = items
    .filter(i => i.action === 'install' || i.action === 'update')
    .map(
      i =>
        `  ${VERB[i.action]} ${displayPath(i.path, root)} — ${i.label ?? KIND_LABEL[i.kind]}`
    )
  return lines.length > 0 ? lines.join('\n') + '\n' : '  (nothing to change)\n'
}

// ── rendering ──────────────────────────────────────────────────────────────

const VERB: Record<InitAction, string> = {
  install: 'would install',
  update: 'would update',
  unchanged: '·',
  skip: `${icons.warning} skip`,
  error: `${icons.error} cannot plan`,
}

const indent = (text: string, pad = '    '): string =>
  text
    .split('\n')
    .map(l => (l === '' ? '' : pad + l))
    .join('\n')

/**
 * Plain-text report: one heading line per file, then its notes and diffs
 * indented beneath; a summary line at the end. Diff lines are
 * indented four spaces (strip them to feed `patch`).
 */
export function renderInitPlan(
  items: readonly InitItem[],
  opts: {
    cliVersion: string | null
    /** The git repo root. */
    root: string
    /** The command that applies the plan, e.g. `lumo init --agent codex`. */
    applyCommand: string
    /** Folder install (not a git repo): shows the folder warnings. */
    folder?: boolean
  }
): string {
  let out = `Lumo init --dry-run — ${opts.folder ? 'folder' : 'repo'} ${opts.root}, nothing is written (CLI ${opts.cliVersion ?? 'unknown version'})\n\n`
  if (opts.folder)
    out +=
      folderWarnings(opts.root)
        .map(w => `${w}\n`)
        .join('') + '\n'
  for (const i of items) {
    out += `${VERB[i.action]} ${displayPath(i.path, opts.root)} — ${i.label ?? KIND_LABEL[i.kind]}: ${i.summary}\n`
    for (const n of i.notes) out += `    ${n}\n`
    for (const d of i.diffs) out += `\n${indent(d)}\n`
    if (i.diffs.length > 0) out += '\n'
  }
  const changing = items.filter(
    i => i.action === 'install' || i.action === 'update'
  )
  const retrust = items.filter(i => i.retrust).length
  const errors = items.filter(i => i.action === 'error').length
  out += '\n'
  if (changing.length === 0 && errors === 0) {
    out += `Nothing to change — ${items.length === 1 ? 'the Lumo install is' : `all ${items.length} are`} up to date or left as is.\n`
    return out
  }
  out += `${changing.length} of ${items.length} would change`
  if (retrust > 0) out += `; ${retrust} would make Codex ask to trust hooks`
  if (errors > 0)
    out += `; ${errors} cannot be planned (\`lumo init\` would fail ${errors === 1 ? 'it' : 'them'} too)`
  out += '.\n'
  if (changing.length > 0) out += `Run \`${opts.applyCommand}\` to apply.\n`
  return out
}
