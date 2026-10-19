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
  retiredLumoHookEvents,
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

  it('an explicit event list (Codex) does not strip anything', () => {
    const existing = olderInstall()
    const { merged, stats } = mergeLumoHooks(
      existing,
      'codex',
      CODEX_HOOK_EVENTS
    )
    expect(stats.removedEvents).toEqual([])
    expect(merged.hooks).toHaveProperty('WorktreeCreate')
  })

  it('retiredLumoHookEvents names only the retired events Lumo still holds', () => {
    expect(retiredLumoHookEvents(olderInstall().hooks)).toEqual([
      'WorktreeCreate',
      'WorktreeRemove',
    ])
    expect(retiredLumoHookEvents(buildLumoHookFragment().hooks)).toEqual([])
    expect(
      retiredLumoHookEvents({
        WorktreeCreate: [
          { hooks: [{ type: 'command', command: 'my-vcs-worktree.sh' }] },
        ],
      })
    ).toEqual([])
    expect(retiredLumoHookEvents(undefined)).toEqual([])
  })

  it("this repo's own .claude/settings.json carries no Lumo worktree hooks", () => {
    const settings = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '.claude', 'settings.json'),
        'utf8'
      )
    ) as { hooks?: unknown }
    expect(retiredLumoHookEvents(settings.hooks)).toEqual([])
  })
})
