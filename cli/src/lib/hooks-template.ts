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

/**
 * LUM-1051: the Codex hook events Lumo handles (codex-cli 0.162.0, LUM-1050
 * probe). Nine share a Claude Code name; PreCompact / PostCompact / Interrupt
 * are Codex-only. The other 16 Claude events have no Codex counterpart — an
 * unknown name in hooks.json is silently ignored, so they are left out rather
 * than written as dead entries.
 */
export const CODEX_HOOK_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['SessionStart', 'session-start'],
  ['SessionEnd', 'session-end'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PreToolUse', 'pre-tool-use'],
  ['PermissionRequest', 'permission-request'],
  ['PostToolUse', 'post-tool-use'],
  ['PreCompact', 'pre-compact'],
  ['PostCompact', 'post-compact'],
  ['SubagentStart', 'subagent-start'],
  ['SubagentStop', 'subagent-stop'],
  ['Stop', 'stop'],
  ['Interrupt', 'interrupt'],
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
function isLumoHookCommand(command: string, slug: string): boolean {
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

// Idempotent merge: copies every key from `existing` (preserving user config),
// then for each Lumo event ensures exactly one `lumo hook <slug> --agent
// <token>` entry is present. An existing Lumo entry (with any/no `--agent`
// suffix) is rewritten in place to the desired command — so re-running setup
// with a different agent, or upgrading a legacy flagless entry, never leaves a
// duplicate. Existing non-lumo hook groups for the same event are left alone.
// Returns the merged object plus stats describing what changed.
export type MergeStats = {
  addedEvents: string[]
  alreadyPresent: string[]
  updatedEvents: string[]
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
  const stats: MergeStats = {
    addedEvents: [],
    alreadyPresent: [],
    updatedEvents: [],
  }

  for (const [event, slug] of events) {
    const ourCmd = `lumo hook ${slug} --agent ${agentToken}`
    const groups = base.hooks[event] ?? []

    let exact = false
    let rewritten = false
    for (const g of groups) {
      if (!Array.isArray(g.hooks)) continue
      for (const h of g.hooks) {
        if (h.command === ourCmd) {
          exact = true
        } else if (isLumoHookCommand(h.command, slug)) {
          // legacy flagless or a different agent token — bring it up to date
          h.command = ourCmd
          rewritten = true
        }
      }
    }

    if (exact) {
      stats.alreadyPresent.push(event)
      base.hooks[event] = groups
      continue
    }
    if (rewritten) {
      stats.updatedEvents.push(event)
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
