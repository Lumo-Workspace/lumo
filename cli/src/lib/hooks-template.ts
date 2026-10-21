// Canonical list of Claude Code hook events that the Lumo CLI handles via
// `lumo hook <event>`. Each entry maps a Claude Code event name (CamelCase,
// matches settings.json keys) to the slug-form subcommand. Kept in sync with
// the `hook` subcommand registrations in cli/src/index.ts and with the
// repository's own .claude/settings.json.
export const LUMO_HOOK_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['PreToolUse', 'pre-tool-use'],
  ['PostToolUse', 'post-tool-use'],
  ['PostToolUseFailure', 'post-tool-use-failure'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['Stop', 'stop'],
  ['StopFailure', 'stop-failure'],
  ['PermissionRequest', 'permission-request'],
  ['PermissionDenied', 'permission-denied'],
  ['SessionStart', 'session-start'],
  ['SessionEnd', 'session-end'],
  ['SubagentStart', 'subagent-start'],
  ['SubagentStop', 'subagent-stop'],
  ['TaskCreated', 'task-created'],
  ['PostToolBatch', 'post-tool-batch'],
  ['Notification', 'notification'],
  ['Elicitation', 'elicitation'],
  ['ElicitationResult', 'elicitation-result'],
]

/**
 * LUM-1051: the Codex hook events Lumo handles (codex-cli 0.162.0, LUM-1050
 * probe). Only events that share a Claude Code name are registered; Codex's
 * compaction and interrupt events are not (SessionStart re-runs with
 * source=compact, and the timeline does not need the rest). An unknown name in
 * hooks.json is silently ignored, so Claude-only events are left out rather
 * than written as dead entries.
 */
export const CODEX_HOOK_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['SessionStart', 'session-start'],
  ['SessionEnd', 'session-end'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PreToolUse', 'pre-tool-use'],
  ['PermissionRequest', 'permission-request'],
  ['PostToolUse', 'post-tool-use'],
  ['SubagentStart', 'subagent-start'],
  ['SubagentStop', 'subagent-stop'],
  ['Stop', 'stop'],
]

type HookEntry = { type: 'command'; command: string }
type HookGroup = { matcher?: string; hooks: HookEntry[] }
type SettingsShape = { hooks?: Record<string, HookGroup[]> }

/** Default agent token baked into the hook commands when none is given. */
const DEFAULT_AGENT_TOKEN = 'claude-code'

/**
 * A hook command belongs to Lumo when it is exactly `lumo hook <slug>` or
 * carries trailing flags (`lumo hook <slug> --agent codex`). We match on the
 * prefix so a re-run can recognize — and rewrite — an entry baked with a
 * different (or no) `--agent` token.
 */
export function isLumoHookCommand(command: string, slug: string): boolean {
  return (
    command === `lumo hook ${slug}` || command.startsWith(`lumo hook ${slug} `)
  )
}

// Build the settings.json fragment we want to install. We do not use a
// matcher because the Lumo hook handlers ingest every event of a given type;
// adding a matcher would silently drop events that have no `tool_name` (e.g.
// SessionStart). Keep this in step with cli/src/commands/hook.ts dispatch.
//
// `agentToken` is baked into every command (`lumo hook <slug> --agent
// <token>`) so the hook tells the server which coding agent owns the session.
export function buildLumoHookFragment(
  agentToken: string = DEFAULT_AGENT_TOKEN,
  events: ReadonlyArray<readonly [string, string]> = LUMO_HOOK_EVENTS
): SettingsShape {
  const hooks: Record<string, HookGroup[]> = {}
  for (const [event, slug] of events) {
    hooks[event] = [
      {
        hooks: [
          {
            type: 'command',
            command: `lumo hook ${slug} --agent ${agentToken}`,
          },
        ],
      },
    ]
  }
  return { hooks }
}

/**
 * A hook command belongs to Lumo when it is `lumo hook` or starts with
 * `lumo hook ` (any slug, any flags). Ownership is by command, not by event:
 * a merge replaces every such entry, so events dropped from the template —
 * and entries baked with another `--agent` — never linger.
 */
export function isLumoHookEntry(command: string): boolean {
  return command === 'lumo hook' || command.startsWith('lumo hook ')
}

// Ownership merge: copies every key from `existing` (preserving user config),
// then makes Lumo's entries exactly one `lumo hook <slug> --agent <token>` per
// event in `events`. A Lumo entry that is already exactly right is left where
// it is (so a re-run is byte-identical); any other Lumo entry — an older flag
// form, another agent token, or an event no longer in the set — is removed,
// together with groups and events that emptied. Non-Lumo hooks are never
// touched. Codex tolerates events at the file root as well as under `hooks`;
// Lumo entries at the root are moved under `hooks`.
// Returns the merged object plus stats describing what changed.
export type MergeStats = {
  addedEvents: string[]
  alreadyPresent: string[]
  updatedEvents: string[]
  /** Events whose Lumo entries were removed and are not in the new set. */
  removedEvents: string[]
}

type Holder = Record<string, unknown>

/** Lumo-owned commands per event in `holder`, in file order. */
function lumoCommandsByEvent(holder: Holder): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [event, groups] of Object.entries(holder)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      const list = (g as { hooks?: unknown } | null)?.hooks
      if (!Array.isArray(list)) continue
      for (const h of list) {
        const c = (h as { command?: unknown } | null)?.command
        if (typeof c !== 'string' || !isLumoHookEntry(c)) continue
        out.set(event, [...(out.get(event) ?? []), c])
      }
    }
  }
  return out
}

/** Drop Lumo entries (and what that emptied) of `event` from `holder`. */
function dropLumoEntries(holder: Holder, event: string): void {
  const groups = holder[event]
  if (!Array.isArray(groups)) return
  const kept: unknown[] = []
  for (const g of groups) {
    const list = (g as { hooks?: unknown } | null)?.hooks
    if (!Array.isArray(list)) {
      kept.push(g)
      continue
    }
    const left = list.filter(h => {
      const c = (h as { command?: unknown } | null)?.command
      return !(typeof c === 'string' && isLumoHookEntry(c))
    })
    if (left.length === list.length) kept.push(g)
    else if (left.length > 0) kept.push({ ...(g as object), hooks: left })
  }
  if (kept.length > 0) holder[event] = kept
  else delete holder[event]
}

export function mergeLumoHooks(
  existing: SettingsShape | undefined | null,
  agentToken: string = DEFAULT_AGENT_TOKEN,
  events: ReadonlyArray<readonly [string, string]> = LUMO_HOOK_EVENTS
): {
  merged: SettingsShape
  stats: MergeStats
} {
  const base: SettingsShape = existing
    ? JSON.parse(JSON.stringify(existing))
    : {}
  if (!base.hooks) base.hooks = {}
  const hooks = base.hooks as Holder
  const stats: MergeStats = {
    addedEvents: [],
    alreadyPresent: [],
    updatedEvents: [],
    removedEvents: [],
  }
  const wanted = new Set(events.map(([e]) => e))

  // Lumo entries at the file root (Codex): always moved under `hooks`.
  const root = base as unknown as Holder
  const rootOwned = lumoCommandsByEvent(
    Object.fromEntries(Object.entries(root).filter(([k]) => k !== 'hooks'))
  )
  for (const event of rootOwned.keys()) {
    dropLumoEntries(root, event)
    if (!wanted.has(event)) stats.removedEvents.push(event)
  }

  const owned = lumoCommandsByEvent(hooks)
  for (const event of owned.keys()) {
    if (wanted.has(event)) continue
    dropLumoEntries(hooks, event)
    if (!stats.removedEvents.includes(event)) stats.removedEvents.push(event)
  }

  for (const [event, slug] of events) {
    const ourCmd = `lumo hook ${slug} --agent ${agentToken}`
    const have = owned.get(event) ?? []
    if (have.length === 1 && have[0] === ourCmd && !rootOwned.has(event)) {
      stats.alreadyPresent.push(event)
      continue
    }
    dropLumoEntries(hooks, event)
    hooks[event] = [
      ...((hooks[event] as unknown[] | undefined) ?? []),
      { hooks: [{ type: 'command', command: ourCmd }] },
    ]
    if (have.length > 0 || rootOwned.has(event)) stats.updatedEvents.push(event)
    else stats.addedEvents.push(event)
  }

  return { merged: base, stats }
}

/**
 * Remove Lumo hook entries, keeping every other key, group and hook. Groups
 * and event arrays that this call emptied are dropped (ones already empty are
 * left alone), and so is a `hooks` object that ends up empty. `isOurs`
 * defaults to the `lumo hook` ownership match; pass your
 * own for other agents. With `topLevel` the events live at the root of the
 * file instead of under `hooks` (Codex tolerates both). Never mutates input.
 */
export function removeLumoHooks(
  existing: SettingsShape | undefined | null,
  isOurs: (event: string, command: string) => boolean = defaultIsOurs,
  topLevel = false
): { result: SettingsShape; removed: number } {
  const base = (existing ? JSON.parse(JSON.stringify(existing)) : {}) as Record<
    string,
    unknown
  >
  const holder = (topLevel ? base : base.hooks) as
    | Record<string, unknown>
    | undefined
  let removed = 0
  if (holder && typeof holder === 'object') {
    for (const event of Object.keys(holder)) {
      const groups = holder[event]
      if (!Array.isArray(groups)) continue
      const kept: unknown[] = []
      let touched = false
      for (const g of groups) {
        const list = (g as { hooks?: unknown } | null)?.hooks
        if (!Array.isArray(list)) {
          kept.push(g)
          continue
        }
        const left = list.filter(h => {
          const c = (h as { command?: unknown } | null)?.command
          return !(typeof c === 'string' && isOurs(event, c))
        })
        if (left.length === list.length) {
          kept.push(g)
          continue
        }
        removed += list.length - left.length
        touched = true
        if (left.length > 0) kept.push({ ...(g as object), hooks: left })
      }
      if (!touched) continue
      if (kept.length > 0) holder[event] = kept
      else delete holder[event]
    }
    if (!topLevel && Object.keys(holder).length === 0 && removed > 0)
      delete base.hooks
  }
  return { result: base as SettingsShape, removed }
}

/**
 * The events in `hooks` that carry a Lumo entry although `events` no longer
 * includes them — what `lumo doctor` and the SessionStart drift check report
 * as stale.
 */
export function staleLumoHookEvents(
  hooks: unknown,
  events: ReadonlyArray<readonly [string, string]> = LUMO_HOOK_EVENTS
): string[] {
  if (!hooks || typeof hooks !== 'object') return []
  const wanted = new Set(events.map(([e]) => e))
  return [...lumoCommandsByEvent(hooks as Holder).keys()].filter(
    e => !wanted.has(e)
  )
}

function defaultIsOurs(_event: string, command: string): boolean {
  return isLumoHookEntry(command)
}
