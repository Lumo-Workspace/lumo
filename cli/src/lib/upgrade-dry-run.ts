import * as fs from 'fs'
import * as path from 'path'
import { codexTrustInstructions } from './codex-hooks'
import { classifyCodexRules, LUMO_CODEX_RULES } from './codex-rules'
import {
  HOOK_SCRIPT_BLOCK,
  LUMO_HOOK_BEGIN,
  LUMO_HOOK_END,
} from './git-hook-template'
import { CODEX_HOOK_EVENTS } from './hooks-template'
import {
  collectUpgradeTargets,
  decideSkillInstall,
  planGitHookRefresh,
  planHooksMerge,
  type HooksMergePlan,
} from './install-plan'
import { readRegistry } from './install-registry'
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
 * LUM-1113 — `lumo init --upgrade --dry-run`: for every install
 * `init --upgrade` visits, what it would do (path, action, unified diff) and
 * whether Codex would ask to trust its hooks again. The decisions come from
 * `install-plan` — the same functions the real upgrade acts on — and nothing
 * here writes a file.
 *
 * JSON hook files are diffed on a normalized view that keeps only Lumo's
 * `lumo hook …` entries; everything else in the file is folded to a count so
 * the preview never prints the user's other settings. A prepare-commit-msg
 * shows only its Lumo block.
 */

export type UpgradeItemKind =
  | 'skill'
  | 'claude-settings'
  | 'codex-hooks'
  | 'codex-rules'
  | 'git-hook'

/**
 * - `update`: the file(s) would be rewritten;
 * - `adopt`: content unchanged, only the `.lumo-install.json` marker is written;
 * - `unchanged`: nothing to do;
 * - `skip`: left alone on purpose (modified, newer, not Lumo's, the source repo);
 * - `error`: cannot be planned (unparseable JSON, …) — the real run fails it too.
 */
export type UpgradeAction = 'update' | 'adopt' | 'unchanged' | 'skip' | 'error'

export interface UpgradeItem {
  kind: UpgradeItemKind
  path: string
  action: UpgradeAction
  /** What is (or is not) done, after the path. */
  summary: string
  /** Extra lines (re-trust, git tracking, folded content). */
  notes: string[]
  /** Skill dirs: the per-file change list. */
  files?: SkillFileChange[]
  /** Unified diffs, one per changed file ('' parts omitted). */
  diffs: string[]
  /** Codex will ask to trust these hooks again. */
  retrust: boolean
}

const KIND_LABEL: Record<UpgradeItemKind, string> = {
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

function realPath(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
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
  cliVersion: string
): UpgradeItem {
  const base = { kind: 'skill' as const, path: dir, diffs: [], retrust: false }
  if (!fs.existsSync(path.join(bundled, 'SKILL.md'))) {
    throw new Error(
      `Bundled skill asset missing at ${bundled} — reinstall @lumoai/cli.`
    )
  }
  const d = decideSkillInstall(bundled, dir, false, cliVersion)
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
          'modified locally — left as is (`lumo skill update --force` overwrites it, discarding the edits)',
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
        summary: `${d.fromVersion ?? 'unknown'} → ${cliVersion}: ${filesWord(files.length)} changed`,
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
): UpgradeItem {
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
  const notes: string[] = [
    'ℹ only Lumo\'s `lumo hook …` entries are shown; other settings are folded ("… N other …") and kept as they are',
  ]
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
    notes.push(
      `${icons.warning} Codex will ask to trust these hooks again — events: ${events.join(', ')}`,
      ...codexTrustInstructions(file)
        .split('\n')
        .slice(1)
        .map(l => l.trim())
    )
  }
  if (isPathGitTracked(file)) notes.push(gitNote())
  return {
    kind,
    path: file,
    action: 'update',
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

function codexRulesItem(file: string): UpgradeItem {
  const base = { kind: 'codex-rules' as const, path: file, retrust: false }
  const state = classifyCodexRules(file)
  if (state === 'foreign' || state === 'missing')
    return {
      ...base,
      action: 'skip',
      summary: "no longer Lumo's Codex rule — left as is",
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
  if (isPathGitTracked(file)) notes.push(gitNote())
  return {
    ...base,
    action: 'update',
    summary: 'Lumo-managed file differs from this CLI — rewritten',
    notes,
    diffs: [
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

function gitHookItem(file: string, home: string): UpgradeItem | null {
  const plan = planGitHookRefresh(file)
  if (plan.status === 'absent') return null
  const base = { kind: 'git-hook' as const, path: file, retrust: false }
  if (plan.status === 'unchanged')
    return {
      ...base,
      action: 'unchanged',
      summary: 'up to date',
      notes: [],
      diffs: [],
    }
  const old = lumoBlock(plan.existing)
  return {
    ...base,
    action: 'update',
    summary: old
      ? 'Lumo block replaced'
      : 'Lumo block has no end marker — a fresh block is appended',
    notes: [
      'ℹ only the Lumo block is shown; the rest of the hook is kept as is',
    ],
    diffs: [
      textDiff(
        old,
        `${HOOK_SCRIPT_BLOCK}\n`,
        `${displayPath(file, home)} (now, Lumo block)`,
        `${displayPath(file, home)} (after, Lumo block)`
      ),
    ].filter(Boolean),
  }
}

function errorItem(
  kind: UpgradeItemKind,
  file: string,
  err: unknown
): UpgradeItem {
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

/** Plan every install `init --upgrade` would visit, in the order it runs. Writes nothing. */
export function planUpgrade(args: {
  cliVersion: string
  homeDir: string
  cwd: string
  bundled: string
}): UpgradeItem[] {
  const t = collectUpgradeTargets(
    readRegistry().installs,
    args.homeDir,
    args.cwd
  )
  const items: UpgradeItem[] = []
  // The same file reached by two spellings (a registry path and the detected
  // real path, e.g. /var vs /private/var) is written once by the real run —
  // its second visit finds it up to date — so it is planned once.
  const seen = new Set<string>()
  const attempt = (
    kind: UpgradeItemKind,
    file: string,
    fn: () => UpgradeItem | null
  ): void => {
    const key = `${kind}\0${realPath(file)}`
    if (seen.has(key)) return
    seen.add(key)
    try {
      const item = fn()
      if (item) items.push(item)
    } catch (err) {
      items.push(errorItem(kind, file, err))
    }
  }
  for (const s of t.skills)
    attempt('skill', s.path, () =>
      skillItem(args.bundled, s.path, args.cliVersion)
    )
  for (const r of t.claudeSettings)
    attempt('claude-settings', r.path, () =>
      hooksItem(
        'claude-settings',
        r.path,
        planHooksMerge(r.path, r.agent),
        r.agent,
        args.homeDir
      )
    )
  for (const c of t.codexHooks)
    attempt('codex-hooks', c.path, () =>
      hooksItem(
        'codex-hooks',
        c.path,
        planHooksMerge(c.path, 'codex', CODEX_HOOK_EVENTS),
        'codex',
        args.homeDir
      )
    )
  for (const r of t.codexRules)
    attempt('codex-rules', r.path, () => codexRulesItem(r.path))
  for (const g of t.gitHooks)
    attempt('git-hook', g.path, () => gitHookItem(g.path, args.homeDir))
  return items
}

// ── rendering ──────────────────────────────────────────────────────────────

const VERB: Record<UpgradeAction, string> = {
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
export function renderUpgradePlan(
  items: readonly UpgradeItem[],
  opts: { cliVersion: string; home: string }
): string {
  let out = `Lumo init --upgrade — dry run, nothing is written (CLI ${opts.cliVersion})\n\n`
  if (items.length === 0) {
    return (
      out +
      'No Lumo installs found — nothing to change. Run `lumo init` to install.\n'
    )
  }
  for (const i of items) {
    out += `${VERB[i.action]} ${displayPath(i.path, opts.home)} — ${KIND_LABEL[i.kind]}: ${i.summary}\n`
    for (const n of i.notes) out += `    ${n}\n`
    for (const f of i.files ?? []) out += formatSkillChangeLine(f)
    for (const d of i.diffs) out += `\n${indent(d)}\n`
    if (i.diffs.length > 0) out += '\n'
  }
  const changing = items.filter(
    i => i.action === 'update' || i.action === 'adopt'
  )
  const retrust = items.filter(i => i.retrust).length
  const errors = items.filter(i => i.action === 'error').length
  out += '\n'
  if (changing.length === 0 && errors === 0) {
    out += `Nothing to change — ${items.length === 1 ? 'the Lumo install is' : `all ${items.length} Lumo installs are`} up to date or left as is.\n`
    return out
  }
  out += `${changing.length} of ${items.length} would change`
  if (retrust > 0)
    out += `; ${retrust} would make Codex ask to trust hooks again`
  if (errors > 0)
    out += `; ${errors} cannot be planned (\`init --upgrade\` would fail ${errors === 1 ? 'it' : 'them'} too)`
  out += '.\n'
  if (changing.length > 0)
    out +=
      'Run `lumo init --upgrade` to apply (it also refreshes the install registry records).\n'
  return out
}
