import * as fs from 'fs'
import * as path from 'path'
import { codexHooksPath, codexTrustInstructions } from './codex-hooks'
import {
  classifyCodexRules,
  codexRulesPath,
  LUMO_CODEX_RULES,
} from './codex-rules'
import {
  HOOK_SCRIPT_BLOCK,
  LUMO_HOOK_BEGIN,
  LUMO_HOOK_END,
} from './git-hook-template'
import { CODEX_HOOK_EVENTS } from './hooks-template'
import {
  decideSkillInstall,
  planGitHookInstall,
  planHooksMerge,
  type HooksMergePlan,
} from './install-plan'
import { isPathGitTracked } from './install-state'
import {
  diffSkillDirs,
  displayPath,
  filesWord,
  formatSkillChangeLine,
  type SkillFileChange,
} from './skill-copies'
import { MARKER_FILE } from './skill-hash'
import { icons } from './ui'
import { formatUnifiedDiff } from './unified-diff'

/**
 * LUM-1113 / LUM-1118 — `lumo init --dry-run`: for every file `lumo init`
 * would visit in the chosen scope (and `--agent`), what it would do (path,
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
  | 'skill'
  | 'claude-settings'
  | 'codex-hooks'
  | 'codex-rules'
  | 'git-hook'

/**
 * - `install`: a new file / dir would be written;
 * - `update`: the file(s) would be rewritten;
 * - `adopt`: content unchanged, only the `.lumo-install.json` marker is written;
 * - `unchanged`: nothing to do;
 * - `skip`: left alone on purpose (modified, newer, not Lumo's, the source repo);
 * - `error`: cannot be planned (unparseable JSON, …) — the real run fails it too.
 */
export type InitAction =
  | 'install'
  | 'update'
  | 'adopt'
  | 'unchanged'
  | 'skip'
  | 'error'

export interface InitItem {
  kind: InitItemKind
  path: string
  action: InitAction
  /** What is (or is not) done, after the path. */
  summary: string
  /** Extra lines (re-trust, git tracking, folded content). */
  notes: string[]
  /** Skill dirs: the per-file change list. */
  files?: SkillFileChange[]
  /** Unified diffs, one per changed file ('' parts omitted). */
  diffs: string[]
  /** Codex will ask to trust these hooks (again). */
  retrust: boolean
}

const KIND_LABEL: Record<InitItemKind, string> = {
  skill: 'skill',
  'claude-settings': 'Claude settings hooks',
  'codex-hooks': 'Codex hooks',
  'codex-rules': 'Codex rule',
  'git-hook': 'prepare-commit-msg hook',
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

function gitNote(files?: number): string {
  return files === undefined
    ? `ℹ tracked by git — the change would show up in \`git diff\` for you to commit`
    : `ℹ tracked by git — the update would leave ${filesWord(files)} changed for you to commit in a PR`
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

function skillItem(
  bundled: string,
  dir: string,
  cliVersion: string,
  force: boolean
): InitItem {
  const base = { kind: 'skill' as const, path: dir, diffs: [], retrust: false }
  if (!fs.existsSync(path.join(bundled, 'SKILL.md'))) {
    throw new Error(
      `Bundled skill asset missing at ${bundled} — reinstall @lumoai/cli.`
    )
  }
  const d = decideSkillInstall(bundled, dir, force, cliVersion)
  switch (d.kind) {
    case 'skipped-source':
      return {
        ...base,
        action: 'skip',
        summary: 'Lumo skill source (not an install) — left untouched',
        notes: [],
      }
    case 'skipped-newer':
      return {
        ...base,
        action: 'skip',
        summary: `${d.installed} is newer than this CLI (${cliVersion}) — never downgraded; run \`lumo update\``,
        notes: [],
      }
    case 'skipped-modified':
      return {
        ...base,
        action: 'skip',
        summary:
          'modified locally — left as is (`--force` overwrites it, discarding the edits)',
        notes: [],
      }
    case 'up-to-date':
      return d.adoptVersion === null
        ? { ...base, action: 'unchanged', summary: 'up to date', notes: [] }
        : {
            ...base,
            action: 'adopt',
            summary: `matches the ${d.adoptVersion} skill — writes only the ${MARKER_FILE} marker`,
            notes: d.gitTracked ? [gitNote()] : [],
          }
    case 'write': {
      const files = diffSkillDirs(bundled, dir)
      if (d.result === 'installed')
        // A fresh copy of the bundle: the file list says it all.
        return {
          ...base,
          action: 'install',
          summary: `new ${cliVersion} copy: ${filesWord(files.length)}`,
          notes: [],
          files,
        }
      const diffs = files.map(f => {
        const installed = path.join(dir, f.file)
        const bundledFile = path.join(bundled, f.file)
        return textDiff(
          f.change === 'added' ? '' : readOrEmpty(installed),
          f.change === 'deleted' ? '' : readOrEmpty(bundledFile),
          f.change === 'added' ? '/dev/null' : `a/${f.file}`,
          f.change === 'deleted' ? '/dev/null' : `b/${f.file}`
        )
      })
      return {
        ...base,
        action: 'update',
        summary: `${d.fromVersion ?? 'modified'} → ${cliVersion}: ${filesWord(files.length)} changed`,
        notes: d.gitTracked ? [gitNote(files.length)] : [],
        files,
        diffs: diffs.filter(Boolean),
      }
    }
  }
}

function hooksItem(
  kind: 'claude-settings' | 'codex-hooks',
  file: string,
  plan: HooksMergePlan,
  agent: string,
  home: string
): InitItem {
  const { addedEvents, updatedEvents } = plan.stats
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
  if (plan.exists && isPathGitTracked(file)) notes.push(gitNote())
  return {
    kind,
    path: file,
    action: plan.exists ? 'update' : 'install',
    summary: `add ${addedEvents.length}, update ${updatedEvents.length} Lumo event${addedEvents.length + updatedEvents.length === 1 ? '' : 's'}${label}`,
    notes,
    diffs: [
      textDiff(
        lumoHooksView(plan.existing),
        lumoHooksView(plan.merged),
        `${displayPath(file, home)} (now, Lumo entries)`,
        `${displayPath(file, home)} (after, Lumo entries)`
      ),
    ].filter(Boolean),
    retrust,
  }
}

function codexRulesItem(file: string, force: boolean): InitItem {
  const base = { kind: 'codex-rules' as const, path: file, retrust: false }
  const state = classifyCodexRules(file)
  if (state === 'foreign' && !force)
    return {
      ...base,
      action: 'skip',
      summary:
        "not written by Lumo — left as is (`--force` replaces it with Lumo's rule)",
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
  if (state !== 'missing' && isPathGitTracked(file)) notes.push(gitNote())
  return {
    ...base,
    action: state === 'missing' ? 'install' : 'update',
    summary:
      state === 'missing'
        ? "Lumo's rule for server-only `lumo` commands"
        : state === 'foreign'
          ? 'not written by Lumo — replaced (--force)'
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

/** The Lumo block of a hook file ('' when its end marker is missing). */
function lumoBlock(text: string): string {
  const begin = text.indexOf(LUMO_HOOK_BEGIN)
  const end = begin === -1 ? -1 : text.indexOf(LUMO_HOOK_END, begin)
  return end === -1 ? '' : text.slice(begin, end + LUMO_HOOK_END.length) + '\n'
}

function gitHookItem(root: string, home: string): InitItem {
  const plan = planGitHookInstall(root)
  const base = { kind: 'git-hook' as const, retrust: false, diffs: [] }
  switch (plan.status) {
    case 'not-repo':
      return {
        ...base,
        path: root,
        action: 'skip',
        summary: 'not a git repository — no hook',
        notes: [],
      }
    case 'degrade':
      return {
        ...base,
        path: plan.coreHooksPath,
        action: 'skip',
        summary:
          'core.hooksPath is set (husky or a custom dir) — never written; `lumo init --project` prints the block to add by hand',
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
  const label = displayPath(file, home)
  if (plan.status === 'created')
    return {
      ...base,
      path: file,
      action: 'install',
      summary: 'new hook with the Lumo block',
      notes: [],
    }
  const old = plan.status === 'updated' ? lumoBlock(plan.existing ?? '') : ''
  return {
    ...base,
    path: file,
    action: 'update',
    summary:
      plan.status === 'appended'
        ? (plan.existing ?? '').includes(LUMO_HOOK_BEGIN)
          ? 'Lumo block has no end marker — a fresh block is appended'
          : 'Lumo block appended; the existing hook is kept'
        : 'Lumo block replaced',
    notes: [
      'ℹ only the Lumo block is shown; the rest of the hook is kept as is',
    ],
    diffs: [
      textDiff(
        old,
        `${HOOK_SCRIPT_BLOCK}\n`,
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

/** Where init puts the skill for an agent token (mirrors `skillInstallDir`). */
function skillDirFor(root: string, token: string): string {
  return token === 'codex'
    ? path.join(root, '.agents', 'skills', 'lumo')
    : path.join(root, '.claude', 'skills', 'lumo')
}

/**
 * Plan every file `lumo init` would visit for `scope` and the agent `tokens`,
 * in the order it runs. Writes nothing.
 */
export function planInit(args: {
  scope: 'user' | 'project'
  tokens: readonly string[]
  /** The scope root: home for `--user`, the cwd for `--project`. */
  root: string
  homeDir: string
  bundled: string
  cliVersion: string
  force: boolean
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
    const skill = skillDirFor(args.root, token)
    attempt('skill', skill, () =>
      skillItem(args.bundled, skill, args.cliVersion, args.force)
    )
    if (token === 'codex') {
      const hooks = codexHooksPath(args.root)
      attempt('codex-hooks', hooks, () =>
        hooksItem(
          'codex-hooks',
          hooks,
          planHooksMerge(hooks, 'codex', CODEX_HOOK_EVENTS),
          'codex',
          args.homeDir
        )
      )
      const rules = codexRulesPath(args.root)
      attempt('codex-rules', rules, () => codexRulesItem(rules, args.force))
    } else {
      const settings = path.join(args.root, '.claude', 'settings.json')
      attempt('claude-settings', settings, () =>
        hooksItem(
          'claude-settings',
          settings,
          planHooksMerge(settings, token),
          token,
          args.homeDir
        )
      )
    }
  }
  if (args.scope === 'project')
    attempt('git-hook', args.root, () => gitHookItem(args.root, args.homeDir))
  return items
}

/** The `lumo init …` command that applies a dry run with the same flags. */
export function initApplyCommand(
  scope: 'user' | 'project',
  opts: { agent?: string; force?: boolean }
): string {
  let cmd = `lumo init --${scope}`
  if (opts.agent !== undefined) cmd += ` --agent ${opts.agent}`
  if (opts.force) cmd += ' --force'
  return cmd
}

// ── rendering ──────────────────────────────────────────────────────────────

const VERB: Record<InitAction, string> = {
  install: 'would install',
  update: 'would update',
  adopt: 'would adopt',
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
 * Plain-text report: one heading line per install, then its notes, file
 * list and diffs indented beneath; a summary line at the end. Diff lines are
 * indented four spaces (strip them to feed `patch`).
 */
export function renderInitPlan(
  items: readonly InitItem[],
  opts: {
    cliVersion: string
    home: string
    scope: 'user' | 'project'
    /** The command that applies the plan, e.g. `lumo init --project`. */
    applyCommand: string
  }
): string {
  let out = `Lumo init --dry-run — ${opts.scope} scope, nothing is written (CLI ${opts.cliVersion})\n\n`
  for (const i of items) {
    out += `${VERB[i.action]} ${displayPath(i.path, opts.home)} — ${KIND_LABEL[i.kind]}: ${i.summary}\n`
    for (const n of i.notes) out += `    ${n}\n`
    for (const f of i.files ?? []) out += formatSkillChangeLine(f)
    for (const d of i.diffs) out += `\n${indent(d)}\n`
    if (i.diffs.length > 0) out += '\n'
  }
  const changing = items.filter(
    i => i.action === 'install' || i.action === 'update' || i.action === 'adopt'
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
  if (changing.length > 0)
    out += `Run \`${opts.applyCommand}\` to apply (it also records the installs in the install registry).\n`
  return out
}
