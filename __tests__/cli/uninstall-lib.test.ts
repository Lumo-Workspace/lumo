/**
 * @jest-environment node
 */
import {
  LUMO_HOOK_EVENTS,
  buildLumoHookFragment,
  mergeLumoHooks,
  removeLumoHooks,
} from '@/cli/src/lib/hooks-template'
import {
  HOOK_SCRIPT_BLOCK,
  mergeGitHook,
  removeGitHookBlock,
} from '@/cli/src/lib/git-hook-template'

describe('removeLumoHooks', () => {
  it('removes every Lumo entry from a freshly merged fragment', () => {
    const merged = mergeLumoHooks({ theme: 'dark' } as never).merged
    const r = removeLumoHooks(merged)
    expect(r.removed).toBe(LUMO_HOOK_EVENTS.length)
    expect(r.result).toEqual({ theme: 'dark' })
  })

  it('keeps foreign hooks, foreign groups and other keys', () => {
    const existing = {
      model: 'x',
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'echo mine' }] },
          {
            hooks: [
              { type: 'command', command: 'lumo hook stop --agent codex' },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'lumo hook pre-tool-use --agent claude-code',
              },
              { type: 'command', command: 'my-linter' },
            ],
          },
        ],
        Custom: [{ hooks: [{ type: 'command', command: 'lumo hook stop' }] }],
      },
    }
    const r = removeLumoHooks(existing as never)
    expect(r.removed).toBe(2)
    expect(r.result).toEqual({
      model: 'x',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'my-linter' }],
          },
        ],
        Custom: existing.hooks.Custom,
      },
    })
  })

  it('does not mutate its input and reports 0 when nothing matches', () => {
    const existing = buildLumoHookFragment()
    const copy = JSON.parse(JSON.stringify(existing))
    removeLumoHooks(existing)
    expect(existing).toEqual(copy)
    const r = removeLumoHooks({ hooks: { Stop: [] } } as never)
    expect(r.removed).toBe(0)
  })

  it('custom matcher handles the Codex shapes (nested and top-level)', () => {
    const isCodex = (_e: string, c: string): boolean =>
      c.startsWith('lumo hook ')
    const nested = {
      hooks: {
        Foo: [
          {
            hooks: [
              { type: 'command', command: 'lumo hook foo --agent codex' },
            ],
          },
        ],
        Bar: [{ hooks: [{ type: 'command', command: 'keep' }] }],
      },
    }
    const n = removeLumoHooks(nested as never, isCodex)
    expect(n.removed).toBe(1)
    expect(n.result).toEqual({
      hooks: { Bar: [{ hooks: [{ type: 'command', command: 'keep' }] }] },
    })
    const flat = {
      Foo: [{ hooks: [{ type: 'command', command: 'lumo hook foo' }] }],
      Bar: [{ hooks: [{ type: 'command', command: 'keep' }] }],
    }
    const f = removeLumoHooks(flat as never, isCodex, true)
    expect(f.removed).toBe(1)
    expect(f.result).toEqual({
      Bar: [{ hooks: [{ type: 'command', command: 'keep' }] }],
    })
  })
})

describe('removeGitHookBlock', () => {
  it('a Lumo-only file is deleted (content null)', () => {
    const created = mergeGitHook(null).content
    expect(removeGitHookBlock(created)).toEqual({
      content: null,
      changed: true,
    })
  })

  it('preserves the user content around the block', () => {
    const mine = '#!/bin/sh\necho before\n'
    const appended = mergeGitHook(mine).content
    const r = removeGitHookBlock(appended)
    expect(r.changed).toBe(true)
    expect(r.content).toBe('#!/bin/sh\necho before\n')
    expect(r.content).not.toContain('lumo')
  })

  it('keeps content that follows the block', () => {
    const text = `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\necho after\n`
    const r = removeGitHookBlock(text)
    expect(r.content).toBe('#!/bin/sh\necho after\n')
  })

  it('no markers or an unterminated block change nothing', () => {
    expect(removeGitHookBlock('#!/bin/sh\necho hi\n')).toEqual({
      content: '#!/bin/sh\necho hi\n',
      changed: false,
    })
    const broken = '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nfoo\n'
    expect(removeGitHookBlock(broken)).toEqual({
      content: broken,
      changed: false,
    })
  })

  it('a husky-style file with only the block and no shebang is deleted', () => {
    expect(removeGitHookBlock(`${HOOK_SCRIPT_BLOCK}\n`).content).toBeNull()
  })
})
