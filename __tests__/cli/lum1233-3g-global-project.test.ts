/**
 * @jest-environment node
 *
 * LUM-1233 batch 3g (GF-1, GF-2, Q6) — `--project <ref>` is one global flag;
 * the scope booleans of `init` / `skill update` became `--scope user|project`;
 * the hidden `setup` alias and `task list -p` went.
 */
import fs from 'fs'
import path from 'path'
import type { CliGrammar } from '@/scripts/cli-grammar/grammar'
import { validateSegment } from '@/scripts/cli-grammar/validate'
import { findRemovedCommand } from '@/cli/src/lib/removed-commands'
import { parseInstallScope } from '@/cli/src/lib/install-scope'
import { initApplyCommand } from '@/cli/src/lib/init-dry-run'
import { skillUpdate } from '@/cli/src/commands/skill'

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

  it('init and skill update take --scope user | project', () => {
    for (const p of ['init', 'skill update'])
      expect(grammar.commands[p]!.flags['--scope']!.enum).toEqual([
        'user',
        'project',
      ])
  })

  it('the validator accepts --project on any command and refuses the old booleans', () => {
    for (const ok of [
      'lumo task list --project app --status todo',
      'lumo milestone list --project app',
      'lumo doc list --project app',
      'lumo whoami --project app',
      'lumo init --scope project --dry-run',
    ])
      expect(validateSegment(ok, grammar).kind).toBe('valid')
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
    [['setup', '--project', '--force'], 'lumo init --scope project --force'],
    [['init', '--project'], 'lumo init --scope project'],
    [['init', '--project', '--force'], 'lumo init --scope project --force'],
    // The old boolean never swallows the next flag or its value.
    [
      ['init', '--project', '--agent', 'claude-code', '--dry-run'],
      'lumo init --scope project --agent claude-code --dry-run',
    ],
    [
      ['setup', '--project', '--agent', 'codex'],
      'lumo init --scope project --agent codex',
    ],
    [
      ['init', '--user', '--agent', 'codex'],
      'lumo init --scope user --agent codex',
    ],
    [
      ['skill', 'update', '--project', '--dry-run'],
      'lumo skill update --scope project --dry-run',
    ],
    [['skill', 'update', '--user'], 'lumo skill update --scope user'],
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
      ['init', '--scope', 'project'],
      ['init'],
      ['skill', 'update', '--scope', 'user'],
      ['task', 'list', '--project', 'app'],
      ['--project', 'app', 'task', 'list'],
    ])
      expect(findRemovedCommand(argv, tv)).toBeNull()
  })
})

describe('--scope', () => {
  it('parses user | project case-insensitively, anything else is null', () => {
    expect(parseInstallScope('user')).toBe('user')
    expect(parseInstallScope(' Project ')).toBe('project')
    expect(parseInstallScope('all')).toBeNull()
    expect(parseInstallScope(undefined)).toBeNull()
  })

  it('the dry-run apply command names --scope', () => {
    expect(initApplyCommand('project', { agent: 'codex', force: true })).toBe(
      'lumo init --scope project --agent codex --force'
    )
  })

  it('skill update with an invalid --scope exits 2 before touching anything', async () => {
    const err: string[] = []
    expect(
      await skillUpdate({ scope: 'all' }, { err: s => void err.push(s) })
    ).toBe(2)
    expect(err.join('')).toMatch(/invalid --scope "all"/)
  })
})
