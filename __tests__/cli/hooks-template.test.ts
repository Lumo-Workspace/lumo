/**
 * @jest-environment node
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildLumoHookFragment,
  CODEX_HOOK_EVENTS,
  LUMO_HOOK_EVENTS,
  mergeLumoHooks,
  isLumoHookEntry,
  staleLumoHookEvents,
} from '@/cli/src/lib/hooks-template'

type Settings = Parameters<typeof mergeLumoHooks>[0]
type HookGroup = {
  matcher?: string
  hooks: { type: string; command: string }[]
}

function commandsFor(
  settings: { hooks?: Record<string, HookGroup[]> },
  event: string
): string[] {
  return (settings.hooks?.[event] ?? []).flatMap(g =>
    g.hooks.map(h => h.command)
  )
}

/** Build a typed settings fixture with one Lumo Stop command. */
function settingsWithStop(command: string): Settings {
  return { hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }
}

describe('buildLumoHookFragment', () => {
  it('bakes the --agent token into every command (default claude-code)', () => {
    const fragment = buildLumoHookFragment()
    expect(commandsFor(fragment, 'Stop')).toEqual([
      'lumo hook stop --agent claude-code',
    ])
  })

  it('bakes an explicit agent token', () => {
    const fragment = buildLumoHookFragment('codex')
    expect(commandsFor(fragment, 'Stop')).toEqual([
      'lumo hook stop --agent codex',
    ])
    expect(commandsFor(fragment, 'PreToolUse')).toEqual([
      'lumo hook pre-tool-use --agent codex',
    ])
  })
})

describe('mergeLumoHooks', () => {
  it('adds agent-tagged commands for every event into an empty settings', () => {
    const { merged, stats } = mergeLumoHooks({}, 'codex')
    expect(commandsFor(merged, 'Stop')).toEqual([
      'lumo hook stop --agent codex',
    ])
    expect(stats.addedEvents).toContain('Stop')
  })

  it('is idempotent when the desired agent-tagged command is already present', () => {
    const existing = settingsWithStop('lumo hook stop --agent codex')
    const { merged, stats } = mergeLumoHooks(existing, 'codex')
    expect(commandsFor(merged, 'Stop')).toEqual([
      'lumo hook stop --agent codex',
    ])
    expect(stats.alreadyPresent).toContain('Stop')
    expect(stats.addedEvents).not.toContain('Stop')
  })

  it('upgrades a legacy flagless `lumo hook <slug>` entry to the agent-tagged form', () => {
    const existing = settingsWithStop('lumo hook stop')
    const { merged, stats } = mergeLumoHooks(existing, 'claude-code')
    expect(commandsFor(merged, 'Stop')).toEqual([
      'lumo hook stop --agent claude-code',
    ])
    // no duplicate left behind
    expect(commandsFor(merged, 'Stop')).toHaveLength(1)
    expect(stats.updatedEvents).toContain('Stop')
  })

  it('rewrites the agent token when re-run with a different agent', () => {
    const existing = settingsWithStop('lumo hook stop --agent claude-code')
    const { merged } = mergeLumoHooks(existing, 'codex')
    expect(commandsFor(merged, 'Stop')).toEqual([
      'lumo hook stop --agent codex',
    ])
  })

  it('preserves non-lumo hook entries for the same event', () => {
    const existing = settingsWithStop('some-other-tool hook')
    const { merged } = mergeLumoHooks(existing, 'codex')
    const cmds = commandsFor(merged, 'Stop')
    expect(cmds).toContain('some-other-tool hook')
    expect(cmds).toContain('lumo hook stop --agent codex')
  })
})

// LUM-1235: a WorktreeCreate command hook replaces `git worktree add` and must
// print the new worktree's path; Lumo's forwarder printed nothing, so every
// Claude Code worktree failed in a repo with Lumo hooks installed.
describe('retired WorktreeCreate / WorktreeRemove hooks (LUM-1235)', () => {
  const lumo = (slug: string) => ({
    hooks: [
      {
        type: 'command' as const,
        command: `lumo hook ${slug} --agent claude-code`,
      },
    ],
  })
  /** What `lumo init` wrote before LUM-1235: every event plus the worktree pair. */
  function olderInstall(): NonNullable<Settings> {
    const { hooks } = buildLumoHookFragment('claude-code')
    return {
      hooks: {
        ...hooks,
        WorktreeCreate: [lumo('worktree-create')],
        WorktreeRemove: [lumo('worktree-remove')],
      },
    }
  }

  it('the template no longer installs them', () => {
    const events = LUMO_HOOK_EVENTS.map(([e]) => e)
    expect(events).not.toContain('WorktreeCreate')
    expect(events).not.toContain('WorktreeRemove')
    const { hooks } = buildLumoHookFragment()
    expect(hooks).not.toHaveProperty('WorktreeCreate')
    expect(hooks).not.toHaveProperty('WorktreeRemove')
  })

  it("a merge removes Lumo's entries from an older install and reports them", () => {
    const { merged, stats } = mergeLumoHooks(olderInstall(), 'claude-code')
    expect(merged.hooks).not.toHaveProperty('WorktreeCreate')
    expect(merged.hooks).not.toHaveProperty('WorktreeRemove')
    expect(stats.removedEvents).toEqual(['WorktreeCreate', 'WorktreeRemove'])
    expect(stats.addedEvents).toEqual([])
    expect(stats.alreadyPresent).toHaveLength(LUMO_HOOK_EVENTS.length)
  })

  it('removes flagless and other-agent forms too', () => {
    const { merged, stats } = mergeLumoHooks(
      {
        hooks: {
          WorktreeCreate: [
            {
              hooks: [
                { type: 'command', command: 'lumo hook worktree-create' },
              ],
            },
          ],
          WorktreeRemove: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'lumo hook worktree-remove --agent cursor',
                },
              ],
            },
          ],
        },
      },
      'claude-code'
    )
    expect(stats.removedEvents).toEqual(['WorktreeCreate', 'WorktreeRemove'])
    expect(merged.hooks).not.toHaveProperty('WorktreeCreate')
  })

  it("keeps the user's own WorktreeCreate hook and other settings", () => {
    const own = { type: 'command' as const, command: 'my-vcs-worktree.sh' }
    const existing = olderInstall() as NonNullable<Settings> & {
      permissions: unknown
    }
    existing.permissions = { allow: ['Bash(ls)'] }
    existing.hooks!.WorktreeCreate = [
      { hooks: [own, ...lumo('worktree-create').hooks] },
    ]
    const { merged, stats } = mergeLumoHooks(existing, 'claude-code')
    expect(commandsFor(merged, 'WorktreeCreate')).toEqual([
      'my-vcs-worktree.sh',
    ])
    expect((merged as { permissions?: unknown }).permissions).toEqual({
      allow: ['Bash(ls)'],
    })
    expect(stats.removedEvents).toEqual(['WorktreeCreate', 'WorktreeRemove'])
  })

  it('a second merge has nothing left to remove', () => {
    const once = mergeLumoHooks(olderInstall(), 'claude-code').merged
    const twice = mergeLumoHooks(once, 'claude-code')
    expect(twice.stats.removedEvents).toEqual([])
    expect(twice.merged).toEqual(once)
  })

  it('an explicit event list (Codex) drops Lumo entries outside it', () => {
    const { merged, stats } = mergeLumoHooks(
      olderInstall(),
      'codex',
      CODEX_HOOK_EVENTS
    )
    expect(merged.hooks).not.toHaveProperty('WorktreeCreate')
    expect(Object.keys(merged.hooks!).sort()).toEqual(
      CODEX_HOOK_EVENTS.map(([e]) => e).sort()
    )
    expect(stats.removedEvents).toContain('WorktreeCreate')
  })

  it('staleLumoHookEvents names the events Lumo holds outside the set', () => {
    expect(staleLumoHookEvents(olderInstall().hooks)).toEqual([
      'WorktreeCreate',
      'WorktreeRemove',
    ])
    expect(staleLumoHookEvents(buildLumoHookFragment().hooks)).toEqual([])
    expect(
      staleLumoHookEvents({
        WorktreeCreate: [
          { hooks: [{ type: 'command', command: 'my-vcs-worktree.sh' }] },
        ],
      })
    ).toEqual([])
    expect(staleLumoHookEvents(undefined)).toEqual([])
  })

  it("this repo's own .claude/settings.json carries no stale Lumo hooks", () => {
    const settings = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '.claude', 'settings.json'),
        'utf8'
      )
    ) as { hooks?: unknown }
    expect(staleLumoHookEvents(settings.hooks)).toEqual([])
  })
})

describe('hook event sets', () => {
  it('registers 17 Claude Code events and 9 Codex events', () => {
    const claude = LUMO_HOOK_EVENTS.map(([e]) => e)
    expect(claude).toHaveLength(17)
    for (const dropped of [
      'FileChanged',
      'ConfigChange',
      'InstructionsLoaded',
      'CwdChanged',
      'UserPromptExpansion',
      'TaskCompleted',
      'PreCompact',
    ])
      expect(claude).not.toContain(dropped)
    expect(claude).toContain('SubagentStart')
    const codex = CODEX_HOOK_EVENTS.map(([e]) => e)
    for (const dropped of ['PreCompact', 'PostCompact', 'Interrupt'])
      expect(codex).not.toContain(dropped)
  })

  it('isLumoHookEntry matches `lumo hook` commands only', () => {
    expect(isLumoHookEntry('lumo hook')).toBe(true)
    expect(isLumoHookEntry('lumo hook stop --agent codex')).toBe(true)
    expect(isLumoHookEntry('lumo hooks')).toBe(false)
    expect(isLumoHookEntry('echo lumo hook stop')).toBe(false)
    expect(isLumoHookEntry('lumo task show')).toBe(false)
  })
})

describe('ownership merge', () => {
  const entry = (command: string) => ({
    hooks: [{ type: 'command' as const, command }],
  })

  it('leaves exactly one Lumo entry per current event and keeps user hooks', () => {
    const hooks: NonNullable<Settings>['hooks'] = {}
    for (const e of [
      ...LUMO_HOOK_EVENTS,
      ['FileChanged', 'file-changed'],
      ['ConfigChange', 'config-change'],
      ['InstructionsLoaded', 'instructions-loaded'],
      ['CwdChanged', 'cwd-changed'],
      ['UserPromptExpansion', 'user-prompt-expansion'],
      ['TaskCompleted', 'task-completed'],
      ['PreCompact', 'pre-compact'],
      ['WorktreeCreate', 'worktree-create'],
    ] as const)
      hooks[e[0]] = [entry(`lumo hook ${e[1]} --agent claude-code`)]
    hooks.Stop!.push(entry('lumo hook stop --agent codex'))
    hooks.PreToolUse!.push(entry('echo hi'))
    const { merged, stats } = mergeLumoHooks({ hooks }, 'claude-code')
    for (const [event, slug] of LUMO_HOOK_EVENTS) {
      const lumo = commandsFor(merged, event).filter(c =>
        c.startsWith('lumo hook')
      )
      expect(lumo).toEqual([`lumo hook ${slug} --agent claude-code`])
    }
    expect(Object.keys(merged.hooks!)).toHaveLength(LUMO_HOOK_EVENTS.length)
    expect(merged.hooks).not.toHaveProperty('WorktreeCreate')
    expect(merged.hooks).not.toHaveProperty('FileChanged')
    expect(commandsFor(merged, 'PreToolUse')).toContain('echo hi')
    expect(stats.removedEvents).toHaveLength(8)
    expect(stats.updatedEvents).toEqual(['Stop'])
  })

  it('a re-merge is byte-identical (user hooks after Lumo keep their place)', () => {
    const existing: Settings = {
      hooks: {
        Stop: [
          entry('lumo hook stop --agent claude-code'),
          entry('echo after'),
        ],
      },
    }
    const once = mergeLumoHooks(existing, 'claude-code').merged
    const twice = mergeLumoHooks(once, 'claude-code')
    expect(JSON.stringify(twice.merged)).toBe(JSON.stringify(once))
    expect(commandsFor(once, 'Stop')).toEqual([
      'lumo hook stop --agent claude-code',
      'echo after',
    ])
    expect(twice.stats.updatedEvents).toEqual([])
    expect(twice.stats.addedEvents).toEqual([])
  })

  it('Codex: drops a stale interrupt entry, keeps the user entry', () => {
    const { hooks } = buildLumoHookFragment('codex', CODEX_HOOK_EVENTS)
    const existing: Settings = {
      hooks: {
        ...hooks,
        Interrupt: [entry('lumo hook interrupt --agent codex')],
        PreCompact: [
          entry('lumo hook pre-compact --agent codex'),
          entry('my-compact.sh'),
        ],
        PreToolUse: [...hooks!.PreToolUse!, entry('echo hi')],
      },
    }
    const { merged, stats } = mergeLumoHooks(
      existing,
      'codex',
      CODEX_HOOK_EVENTS
    )
    expect(merged.hooks).not.toHaveProperty('Interrupt')
    expect(commandsFor(merged, 'PreCompact')).toEqual(['my-compact.sh'])
    expect(commandsFor(merged, 'PreToolUse')).toEqual([
      'lumo hook pre-tool-use --agent codex',
      'echo hi',
    ])
    expect(stats.removedEvents).toEqual(['Interrupt', 'PreCompact'])
  })

  it('Codex: Lumo entries at the file root move under hooks', () => {
    const existing = {
      Interrupt: [entry('lumo hook interrupt --agent codex')],
      Stop: [entry('lumo hook stop --agent codex'), entry('echo bye')],
      model: 'x',
    } as unknown as Settings
    const { merged, stats } = mergeLumoHooks(
      existing,
      'codex',
      CODEX_HOOK_EVENTS
    )
    const root = merged as unknown as Record<string, unknown>
    expect(root).not.toHaveProperty('Interrupt')
    expect(root.model).toBe('x')
    expect(root.Stop).toEqual([entry('echo bye')])
    expect(commandsFor(merged, 'Stop')).toEqual([
      'lumo hook stop --agent codex',
    ])
    expect(stats.removedEvents).toEqual(['Interrupt'])
    expect(stats.updatedEvents).toContain('Stop')
  })
})
