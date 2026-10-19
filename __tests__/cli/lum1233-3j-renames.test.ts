/**
 * @jest-environment node
 *
 * LUM-1233 batch 3j (Q9) — pure renames. Every old name is a tombstone
 * (exit 2, names the new one, not in help or grammar), the new commands keep
 * the old Codex class (the whitelist changes in names only), and server text
 * that names a renamed command follows the caller's CLI version.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import fs from 'fs'
import path from 'path'
import { findRemovedCommand } from '@/cli/src/lib/removed-commands'
import { CODEX_CLASSES } from '@/cli/src/lib/codex-classes.generated'
import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
  cliCommandNamesForVersion,
} from '@/lib/cli/command-names'
import { workspaceSecurityScanUpdate } from '@/cli/src/commands/workspace-security-scan'
import { milestoneUpdate } from '@/cli/src/commands/milestone-update'
import { formatAspects } from '@/cli/src/commands/milestone-show'

const root = path.resolve(__dirname, '../..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')
const grammar = JSON.parse(read('scripts/cli-grammar/grammar.json')) as {
  commands: Record<string, { flags: Record<string, unknown> }>
}
const hand = JSON.parse(
  read('__tests__/fixtures/lum1233-codex-hand-lists.json')
) as {
  serverOnly: string[]
  fileReading: Record<string, string>
  sandboxed: Record<string, string>
}
const fixture = JSON.parse(
  read('__tests__/fixtures/lum1233-3j-renames.json')
) as {
  renames: Record<string, string[]>
  absorbedBy: Record<string, string[]>
}

/** The class a hand-kept entry had, in the shape .codex() declares. */
function handClass(p: string): unknown {
  if (hand.serverOnly.includes(p))
    return { serverOnly: true, localFiles: 'none' }
  if (p in hand.fileReading)
    return {
      serverOnly: false,
      localFiles: 'reads',
      detail: hand.fileReading[p],
    }
  return hand.sandboxed[p]
}

describe('the whitelist changes in names only', () => {
  it.each(Object.entries(fixture.renames).filter(([, n]) => n.length > 0))(
    '%s → %j keeps its Codex class',
    (old, now) => {
      for (const n of now) expect(CODEX_CLASSES[n]).toEqual(handClass(old))
    }
  )

  it.each(Object.entries(fixture.absorbedBy))(
    '%s became an aspect / flag of %j, which keep the same class',
    (old, into) => {
      for (const n of into) expect(CODEX_CLASSES[n]).toEqual(handClass(old))
      expect(grammar.commands).not.toHaveProperty([old])
    }
  )

  it('no old name is a command any more', () => {
    for (const old of Object.keys(fixture.renames))
      expect(
        old === 'task comment' || old === 'workspace security-scan'
          ? Object.keys((grammar.commands[old] ?? { flags: {} }).flags).length // now a plain group: no flags of its own
          : grammar.commands[old]
      ).toBeFalsy()
  })
})

describe('tombstones', () => {
  const tv = (_p: string, f: string) =>
    [
      '--blocked-by',
      '--reply-to',
      '--name',
      '--project',
      '--team',
      '--repo',
      '--scan',
      '--review',
      '--hunt',
    ].includes(f)
  it.each([
    [
      ['task', 'comment', 'LUM-1', 'hello', '--reply-to', 'abc123'],
      'lumo task comment add hello --task LUM-1 --reply-to abc123',
    ],
    [
      ['task', 'comments', 'edit', 'LUM-1', 'abc123', 'new text'],
      "lumo task comment update abc123 'new text' --task LUM-1",
    ],
    [
      ['task', 'comments', 'rm', 'LUM-1', 'abc123', '--yes'],
      'lumo task comment delete abc123 --task LUM-1 --confirm',
    ],
    [
      ['task', 'deps', 'add', 'LUM-1', '--blocked-by', 'LUM-2'],
      'lumo task dep add LUM-1 --blocked-by LUM-2',
    ],
    [
      ['task', 'deps', 'confirm', 'LUM-1', 'e1'],
      'lumo task dep confirm LUM-1 e1',
    ],
    [
      ['task', 'deps', 'dismiss', 'LUM-1', 'e1'],
      'lumo task dep dismiss LUM-1 e1',
    ],
    [
      ['task', 'deps', 'rm', 'LUM-1', 'e1', '--yes'],
      'lumo task dep remove LUM-1 e1 --confirm',
    ],
    [
      ['task', 'artifact', 'rm', 'LUM-1', 'a1', '--confirm'],
      'lumo task artifact delete LUM-1 a1 --confirm',
    ],
    [
      ['task', 'template', 'edit', 'spec', '--name', 'Spec'],
      'lumo task template update spec --name Spec',
    ],
    [
      ['task', 'template', 'rm', 'spec', '--yes'],
      'lumo task template delete spec --confirm',
    ],
    [['task', 'figma', 'rm', 'LUM-1', 'r1'], 'lumo task figma remove LUM-1 r1'],
    [
      ['task', 'figma', 'context', 'LUM-1', 'r1'],
      'lumo task figma show LUM-1 r1',
    ],
    [
      ['project', 'overview', 'lumo', '--report'],
      'lumo project show lumo --report',
    ],
    [
      ['milestone', 'summary', 'beta', '--project', 'app'],
      'lumo milestone show beta --summary --project app',
    ],
    [
      ['milestone', 'summary', 'beta', '--retry'],
      'lumo milestone update beta --refresh-summary',
    ],
    [
      ['milestone', 'changelog', 'beta', '--json'],
      'lumo milestone show beta --changelog --json',
    ],
    [
      ['sprint', 'summary', '3', '--team', 'LUM'],
      'lumo sprint show 3 --summary --team LUM',
    ],
    [
      ['sprint', 'summary', '3', '--retry'],
      'lumo sprint update 3 --refresh-summary',
    ],
    [['workspace', 'security-scan'], 'lumo workspace security-scan show'],
    [
      ['workspace', 'security-scan', '--repo', 'o/r', '--json'],
      'lumo workspace security-scan show --repo o/r --json',
    ],
    [
      ['workspace', 'security-scan', '--hunt', 'off', '--confirm'],
      'lumo workspace security-scan update --hunt off --confirm',
    ],
    [
      ['workspace', 'security-scan', '--repo', 'o/r', '--review', 'on'],
      'lumo workspace security-scan update --repo o/r --review on',
    ],
  ])('%j → %s', (argv, replacement) => {
    expect(findRemovedCommand(argv, tv)?.replacement).toBe(replacement)
  })

  it('the new names are live', () => {
    for (const argv of [
      ['task', 'comment', 'add', 'hi'],
      ['task', 'comment', 'update', 'abc123', 'x'],
      ['task', 'dep', 'add', '--blocked-by', 'LUM-2'],
      ['workspace', 'security-scan', 'show'],
      ['workspace', 'security-scan', 'update', '--hunt', 'off'],
      ['milestone', 'show', 'beta', '--summary'],
    ])
      expect(findRemovedCommand(argv, tv)).toBeNull()
  })
})

describe('new behaviour', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = jest.fn() as unknown as typeof fetch
  })
  afterEach(() => jest.restoreAllMocks())

  it('security-scan update without a setting is a usage error (reading is show)', async () => {
    expect(await workspaceSecurityScanUpdate({ json: true, repo: 'o/r' })).toBe(
      2
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('milestone update needs a field or --refresh-summary', async () => {
    expect(await milestoneUpdate('beta', {})).toBe(2)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('milestone show aspects render after the detail; a failed read is one line', () => {
    const out = formatAspects(
      { stats: { done: 2, total: 3 }, tldr: 'On track.', report: null },
      { error: 'HTTP 500' }
    )
    expect(out).toMatch(/Summary\nDone:  2 \/ 3\n\nOn track\./)
    expect(out).toMatch(/Changelog\nCould not read \(HTTP 500\)/)
    expect(formatAspects(undefined, undefined)).toBe('')
  })

  it('milestone show and sprint show take the aspect flags; update takes --refresh-summary', () => {
    expect(grammar.commands['milestone show']!.flags).toHaveProperty([
      '--summary',
    ])
    expect(grammar.commands['milestone show']!.flags).toHaveProperty([
      '--changelog',
    ])
    expect(grammar.commands['sprint show']!.flags).toHaveProperty(['--summary'])
    for (const p of ['milestone update', 'sprint update'])
      expect(grammar.commands[p]!.flags).toHaveProperty(['--refresh-summary'])
  })
})

describe('server text by CLI version', () => {
  it('names the 3j commands for a current CLI and the old ones for 1.125 and older', () => {
    expect(CURRENT_CLI_COMMANDS.taskFigmaShow('LUM-1', 'abcd1234')).toBe(
      'lumo task figma show LUM-1 abcd1234'
    )
    expect(LEGACY_CLI_COMMANDS.taskFigmaShow('LUM-1', 'abcd1234')).toBe(
      'lumo task figma context LUM-1 abcd1234'
    )
    expect(CURRENT_CLI_COMMANDS.taskDepCleanup).toBe(
      '`lumo task dep remove/dismiss`'
    )
    expect(LEGACY_CLI_COMMANDS.taskDepCleanup).toBe(
      '`lumo task deps rm/dismiss`'
    )
    expect(cliCommandNamesForVersion('1.125.4', {}).renames).toBe(false)
    expect(cliCommandNamesForVersion('1.125.5', {}).renames).toBe(true)
    expect(
      cliCommandNamesForVersion('1.125.5', {
        LUMO_RENAMES_MIN_CLI_VERSION: '1.126.0',
      }).renames
    ).toBe(false)
  })
})
