/**
 * @jest-environment node
 *
 * LUM-1233 batches 3h + 3i (CF-1, CF-2) — approval is `--confirm` only (the
 * legacy `--yes` alias is gone), and `--force` only ever means "discard local
 * edits": `doc rebuild-source --force` went, `--confirm` alone approves
 * replacing an existing source.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(async () => 'doc1'),
}))

import fs from 'fs'
import path from 'path'
import { docRebuildSource } from '@/cli/src/commands/doc-rebuild-source'
import { isConfirmed } from '@/cli/src/lib/confirmation'
import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
  cliCommandNamesForVersion,
} from '@/lib/cli/command-names'
import { asConfirm, findRemovedCommand } from '@/cli/src/lib/removed-commands'

let out: string
let fetchMock: jest.Mock
beforeEach(() => {
  out = ''
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'log').mockImplementation((...a) => {
    out += a.join(' ') + '\n'
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

const body = () =>
  JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)

describe('doc rebuild-source', () => {
  it('without --confirm an existing source is an envelope whose confirmCommand adds only --confirm', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: 'A source already exists' }),
    })
    expect(await docRebuildSource('my-doc', { json: true } as never)).toBe(4)
    expect(body()).toEqual({})
    const env = JSON.parse(out)
    expect(env.confirmCommand).toMatch(/--confirm$/)
    expect(env.confirmCommand).not.toMatch(/--force/)
  })

  it('--confirm asks the API to re-derive the existing source', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        document: { id: 'doc1', slug: 'my-doc', title: 'Notes' },
      }),
    })
    await docRebuildSource('my-doc', { confirm: true })
    expect(body()).toEqual({ force: true })
  })
})

describe('--yes', () => {
  it('no longer approves anything', () => {
    expect(isConfirmed({ yes: true } as never)).toBe(false)
    expect(isConfirmed({ confirm: true })).toBe(true)
  })

  it('no command declares --yes, and doc rebuild-source has no --force', () => {
    const grammar = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
        'utf8'
      )
    ) as { commands: Record<string, { flags: Record<string, unknown> }> }
    expect(
      Object.entries(grammar.commands)
        .filter(([, n]) => '--yes' in n.flags)
        .map(([p]) => p)
    ).toEqual([])
    expect(grammar.commands['doc rebuild-source']!.flags).not.toHaveProperty([
      '--force',
    ])
    // --force keeps its one meaning (discard local edits) where it stays.
    for (const p of ['worktree rm', 'init', 'skill update', 'uninstall'])
      expect(grammar.commands[p]!.flags).toHaveProperty(['--force'])
  })
})

describe('tombstones', () => {
  const tv = (_p: string, f: string) => ['--team', '--project'].includes(f)
  it.each([
    [['doc', 'delete', 'my-doc', '--yes'], 'lumo doc delete my-doc --confirm'],
    [
      ['milestone', 'delete', 'beta', '--yes'],
      'lumo milestone delete beta --confirm',
    ],
    [
      ['sprint', 'close', '3', '--team', 'LUM', '--yes'],
      'lumo sprint close 3 --team LUM --confirm',
    ],
    [['sprint', 'delete', '3', '--yes'], 'lumo sprint delete 3 --confirm'],
    [
      ['task', 'artifact', 'rm', 'LUM-1', 'a1', '--yes'],
      'lumo task artifact delete LUM-1 a1 --confirm',
    ],
    [
      ['task', 'deps', 'rm', 'LUM-1', 'e1', '--confirm', '--yes'],
      'lumo task dep remove LUM-1 e1 --confirm',
    ],
    [
      ['task', 'template', 'rm', 'spec', '--yes'],
      'lumo task template delete spec --confirm',
    ],
    [
      ['worktree', 'rm', 'LUM-1', '--yes', '--force'],
      'lumo worktree rm LUM-1 --confirm --force',
    ],
    [
      ['doc', 'rebuild-source', 'my-doc', '--force', '--confirm'],
      'lumo doc rebuild-source my-doc --confirm',
    ],
    [
      ['doc', 'rebuild-source', 'my-doc', '--force', '--allow-shrink'],
      'lumo doc rebuild-source my-doc --confirm --allow-shrink',
    ],
  ])('%j → %s', (argv, replacement) => {
    expect(findRemovedCommand(argv, tv)?.replacement).toBe(replacement)
  })

  it('the --confirm forms are live; worktree rm --force stays', () => {
    for (const argv of [
      ['doc', 'delete', 'my-doc', '--confirm'],
      ['worktree', 'rm', 'LUM-1', '--force', '--confirm'],
      ['doc', 'rebuild-source', 'my-doc', '--confirm'],
    ])
      expect(findRemovedCommand(argv, tv)).toBeNull()
  })

  it('asConfirm never doubles --confirm', () => {
    expect(asConfirm(['--yes', '--confirm'], '--yes')).toEqual(['--confirm'])
  })
})

describe('server text by CLI version', () => {
  it('names --confirm for a current CLI and --force for 1.125 and older', () => {
    expect(CURRENT_CLI_COMMANDS.rebuildSourceApproval).toBe('--confirm')
    expect(LEGACY_CLI_COMMANDS.rebuildSourceApproval).toBe('--force')
    expect(cliCommandNamesForVersion('1.125.4', {}).confirmOnly).toBe(false)
    expect(cliCommandNamesForVersion('1.125.5', {}).confirmOnly).toBe(true)
    expect(
      cliCommandNamesForVersion('1.125.5', {
        LUMO_CONFIRM_ONLY_MIN_CLI_VERSION: '1.126.0',
      }).rebuildSourceApproval
    ).toBe('--force')
  })
})
