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
  ['WorktreeCreate', 'worktree-create'],
  ['WorktreeRemove', 'worktree-remove'],
  ['FileChanged', 'file-changed'],
  ['ConfigChange', 'config-change'],
  ['TaskCreated', 'task-created'],
  ['TaskCompleted', 'task-completed'],
  ['PostToolBatch', 'post-tool-batch'],
  ['UserPromptExpansion', 'user-prompt-expansion'],
  ['Notification', 'notification'],
  ['Elicitation', 'elicitation'],
  ['ElicitationResult', 'elicitation-result'],
  ['CwdChanged', 'cwd-changed'],
  ['InstructionsLoaded', 'instructions-loaded'],
]

type HookEntry = { type: 'command'; command: string }
type HookGroup = { matcher?: string; hooks: HookEntry[] }
type SettingsShape = { hooks?: Record<string, HookGroup[]> }

// Build the settings.json fragment we want to install. We do not use a
// matcher because the Lumo hook handlers ingest every event of a given type;
// adding a matcher would silently drop events that have no `tool_name` (e.g.
// SessionStart). Keep this in step with cli/src/commands/hook.ts dispatch.
export function buildLumoHookFragment(): SettingsShape {
  const hooks: Record<string, HookGroup[]> = {}
  for (const [event, slug] of LUMO_HOOK_EVENTS) {
    hooks[event] = [
      { hooks: [{ type: 'command', command: `lumo hook ${slug}` }] },
    ]
  }
  return { hooks }
}

// Idempotent merge: copies every key from `existing` (preserving user config),
// then for each Lumo event ensures exactly one `lumo hook <event>` entry is
// present. Existing non-lumo hook groups for the same event are left alone.
// Returns the merged object plus stats describing what changed.
export type MergeStats = {
  addedEvents: string[]
  alreadyPresent: string[]
}

export function mergeLumoHooks(existing: SettingsShape | undefined | null): {
  merged: SettingsShape
  stats: MergeStats
} {
  const base: SettingsShape = existing
    ? JSON.parse(JSON.stringify(existing))
    : {}
  if (!base.hooks) base.hooks = {}
  const stats: MergeStats = { addedEvents: [], alreadyPresent: [] }

  for (const [event, slug] of LUMO_HOOK_EVENTS) {
    const ourCmd = `lumo hook ${slug}`
    const groups = base.hooks[event] ?? []
    const present = groups.some(
      g => Array.isArray(g.hooks) && g.hooks.some(h => h.command === ourCmd)
    )
    if (present) {
      stats.alreadyPresent.push(event)
      base.hooks[event] = groups
      continue
    }
    base.hooks[event] = [
      ...groups,
      { hooks: [{ type: 'command', command: ourCmd }] },
    ]
    stats.addedEvents.push(event)
  }

  return { merged: base, stats }
}
