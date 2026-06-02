/**
 * @jest-environment node
 */
import {
  HOOK_SCRIPT_BLOCK,
  LUMO_HOOK_BEGIN,
  LUMO_HOOK_END,
  mergeGitHook,
  resolveHookInstall,
} from '@/cli/src/lib/git-hook-template'

describe('mergeGitHook', () => {
  it('creates a fresh hook with shebang when none exists', () => {
    const { content, status } = mergeGitHook(null)
    expect(status).toBe('created')
    expect(content.startsWith('#!/bin/sh\n')).toBe(true)
    expect(content).toContain(LUMO_HOOK_BEGIN)
    expect(content).toContain(LUMO_HOOK_END)
  })

  it('treats a blank/whitespace-only file as empty (created)', () => {
    expect(mergeGitHook('   \n').status).toBe('created')
  })

  it('appends the block to a foreign hook, preserving existing content', () => {
    const existing = '#!/bin/sh\necho "my custom hook"\n'
    const { content, status } = mergeGitHook(existing)
    expect(status).toBe('appended')
    expect(content).toContain('echo "my custom hook"')
    expect(content).toContain(LUMO_HOOK_BEGIN)
  })

  it('reports unchanged when our block is already present and identical', () => {
    const first = mergeGitHook(null).content
    const { status } = mergeGitHook(first)
    expect(status).toBe('unchanged')
  })

  it('replaces a stale managed block in place (updated)', () => {
    const stale = `#!/bin/sh\n${LUMO_HOOK_BEGIN}\nold_logic_here\n${LUMO_HOOK_END}\n`
    const { content, status } = mergeGitHook(stale)
    expect(status).toBe('updated')
    expect(content).not.toContain('old_logic_here')
    expect(content).toContain(HOOK_SCRIPT_BLOCK)
  })

  it('appends a clean block when BEGIN marker exists without END (corrupt state)', () => {
    const corrupt = `#!/bin/sh\n${LUMO_HOOK_BEGIN}\norphaned_content\n`
    const { content, status } = mergeGitHook(corrupt)
    expect(status).toBe('appended')
    expect(content).toContain('orphaned_content')
    expect(content).toContain(HOOK_SCRIPT_BLOCK)
  })
})

describe('resolveHookInstall', () => {
  it('installs when core.hooksPath is unset', () => {
    expect(resolveHookInstall(null)).toEqual({ mode: 'install' })
  })

  it('degrades when core.hooksPath is set (husky/custom)', () => {
    expect(resolveHookInstall('.husky/_')).toEqual({ mode: 'degrade' })
  })

  it('treats a whitespace-only hooksPath as unset', () => {
    expect(resolveHookInstall('  ')).toEqual({ mode: 'install' })
  })
})
