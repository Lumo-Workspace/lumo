/**
 * @jest-environment node
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isInitDryRun,
  isSkillRead,
  shouldCheckForUpdates,
} from '@/cli/src/lib/update-gate'

const argv = (...a: string[]): string[] => ['node', 'lumo', ...a]

describe('update-check gate', () => {
  it('isInitDryRun: only `init … --dry-run`', () => {
    expect(isInitDryRun(argv('init', '--dry-run'))).toBe(true)
    expect(isInitDryRun(argv('init', '--agent', 'codex', '--dry-run'))).toBe(
      true
    )
    expect(isInitDryRun(argv('init'))).toBe(false)
    expect(isInitDryRun(argv('memory', 'push', '--dry-run'))).toBe(false)
  })

  it('isSkillRead: only `skill read`', () => {
    expect(isSkillRead(argv('skill', 'read'))).toBe(true)
    expect(isSkillRead(argv('skill', 'read', 'references/x.md'))).toBe(true)
    expect(isSkillRead(argv('skill'))).toBe(false)
    expect(isSkillRead(argv('status'))).toBe(false)
  })

  it('shouldCheckForUpdates skips uninstall, init --dry-run and skill read', () => {
    expect(shouldCheckForUpdates(argv('uninstall'))).toBe(false)
    expect(shouldCheckForUpdates(argv('init', '--dry-run'))).toBe(false)
    expect(shouldCheckForUpdates(argv('skill', 'read'))).toBe(false)
    expect(shouldCheckForUpdates(argv('doctor'))).toBe(true)
    expect(shouldCheckForUpdates(argv('hook'))).toBe(true)
    expect(shouldCheckForUpdates(argv('init'))).toBe(true)
    expect(shouldCheckForUpdates(argv('task', 'list'))).toBe(true)
  })

  it('index.ts gates the notice and the refresh on the predicate, and has no first-run sync', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'cli', 'src', 'index.ts'),
      'utf8'
    )
    expect(src).toMatch(
      /if \(shouldCheckForUpdates\(process\.argv\)\) \{\s*printUpdateNoticeIfAny\(pkg\.name, pkg\.version\)\s*maybeRefreshInBackground\(pkg\.name\)\s*\}/
    )
    expect(src).not.toMatch(/AutoSync/)
  })
})
