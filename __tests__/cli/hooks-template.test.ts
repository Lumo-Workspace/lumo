/**
 * @jest-environment node
 */
import {
  buildLumoHookFragment,
  mergeLumoHooks,
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
