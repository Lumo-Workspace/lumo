/**
 * @jest-environment node
 *
 * LUM-1233 batch 3g (GF-1, GF-2, Q6) — `--project <ref>` is one global flag;
 * the scope booleans of `init` went (LUM-1292: `--scope` too — init sets up
 * the current repo only); the hidden `setup` alias and `task list -p` went.
 */
import fs from 'fs'
import path from 'path'
import type { CliGrammar } from '@/scripts/cli-grammar/grammar'
import { validateSegment } from '@/scripts/cli-grammar/validate'
import { findRemovedCommand } from '@/cli/src/lib/removed-commands'
import { initApplyCommand } from '@/cli/src/lib/init-dry-run'

const grammar = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
    'utf8'
  )
) as CliGrammar

describe('grammar', () => {
  it('--project and --no-hints are program-level; no command declares --project or --user', () => {
    expect(Object.keys(grammar.globalFlags ?? {})).toEqual([
      '--no-hints',
      '--project',
    ])
    expect(grammar.globalFlags!['--project']!.short).toBeNull()
    const declaring = Object.entries(grammar.commands)
      .filter(([, n]) => '--project' in n.flags || '--user' in n.flags)
      .map(([p]) => p)
    expect(declaring).toEqual([])
    expect(grammar.commands).not.toHaveProperty(['setup'])
  })

  it('init and uninstall take no --scope / --force; skill status / update are gone', () => {
    for (const p of ['init', 'uninstall']) {
      expect(grammar.commands[p]!.flags).not.toHaveProperty(['--scope'])
      expect(grammar.commands[p]!.flags).not.toHaveProperty(['--force'])
    }
    expect(grammar.commands).not.toHaveProperty(['skill status'])
    expect(grammar.commands).not.toHaveProperty(['skill update'])
    expect(grammar.commands).toHaveProperty(['skill read'])
  })

  it('the validator accepts --project on any command and refuses the old booleans', () => {
    for (const ok of [
      'lumo task list --project app --status todo',
      'lumo milestone list --project app',
      'lumo doc list --project app',
      'lumo whoami --project app',
      'lumo init --agent codex --dry-run',
    ])
      expect(validateSegment(ok, grammar).kind).toBe('valid')
    expect(validateSegment('lumo init --scope project', grammar)).toMatchObject(
      { kind: 'unknown-flag', offending: '--scope' }
    )
    expect(validateSegment('lumo init --user', grammar)).toMatchObject({
      kind: 'unknown-flag',
      offending: '--user',
    })
    expect(validateSegment('lumo task list -p app', grammar)).toMatchObject({
      kind: 'unknown-flag',
      offending: '-p',
    })
  })
})

describe('tombstones', () => {
  // As the real CLI: the global --project takes a value on every command.
  const tv = (_p: string, f: string) =>
    ['--project', '--agent', '--status', '-p', '--limit', '-n'].includes(f)
  it.each([
    [['setup'], 'lumo init'],
    [['setup', '--project', '--force'], 'lumo init'],
    [['setup', '--scope', 'user', '--dry-run'], 'lumo init --dry-run'],
    [['init', '--project'], 'lumo init'],
    [['init', '--project', '--force'], 'lumo init'],
    // The old boolean never swallows the next flag or its value.
    [
      ['init', '--project', '--agent', 'claude-code', '--dry-run'],
      'lumo init --agent claude-code --dry-run',
    ],
    [['setup', '--project', '--agent', 'codex'], 'lumo init --agent codex'],
    [['init', '--user', '--agent', 'codex'], 'lumo init --agent codex'],
    [
      ['task', 'list', '-p', 'Apollo', '--status', 'todo'],
      'lumo task list --project Apollo --status todo',
    ],
    // A leading global --project and its value are skipped, not read as words.
    [['--project', 'app', 'next'], 'lumo status --next'],
  ])('%j → %s', (argv, replacement) => {
    expect(findRemovedCommand(argv, tv)?.replacement).toBe(replacement)
  })

  it('the new forms are live', () => {
    for (const argv of [
      ['init'],
      ['init', '--agent', 'codex'],
      ['task', 'list', '--project', 'app'],
      ['--project', 'app', 'task', 'list'],
    ])
      expect(findRemovedCommand(argv, tv)).toBeNull()
  })
})

describe('init apply command', () => {
  it('names only the flags init still has', () => {
    expect(initApplyCommand({ agent: 'codex', scanHooks: true })).toBe(
      'lumo init --agent codex --scan-hooks'
    )
    expect(initApplyCommand({})).toBe('lumo init')
  })
})
