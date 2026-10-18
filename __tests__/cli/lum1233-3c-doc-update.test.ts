/**
 * @jest-environment node
 *
 * LUM-1233 batch 3c — sharing and task binding are `doc update` fields
 * (`--add-member/--remove-member [--role]`, `--add-task/--remove-task`), the
 * share list is `doc show --members`, and `doc import-gdoc <url>` became
 * `doc import --gdoc <url>`. The old commands are tombstones, not aliases.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.test',
  })),
}))
jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(async () => 'cdoc1'),
}))

import fs from 'fs'
import path from 'path'
import {
  docShowWithMembers,
  docUpdateWithRelations,
  hasFieldChange,
  hasRelationChange,
  relationUsageError,
} from '@/cli/src/commands/doc-relations'
import { findRemovedCommand } from '@/cli/src/lib/removed-commands'

let fetchMock: jest.Mock
const calls = () =>
  fetchMock.mock.calls.map(
    c =>
      `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${new URL(String(c[0])).pathname}`
  )

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname
    if (p === '/api/workspaces/members')
      return new Response(
        JSON.stringify({
          members: [
            {
              id: 'm1',
              memberId: 'm1',
              name: 'Alice',
              displayName: 'Alice',
              email: 'alice@x.test',
              role: 'MEMBER',
            },
          ],
          agentActors: [],
        })
      )
    if (p.endsWith('/shares') && (init?.method ?? 'GET') === 'GET')
      return new Response(JSON.stringify({ shares: [] }))
    if (p.endsWith('/shares') || p.includes('/shares/'))
      return new Response(JSON.stringify({ ok: true }))
    if (p.includes('/mentions'))
      return new Response(
        JSON.stringify({
          mention: {
            taskIdentifier: 'LUM-42',
            alreadyBound: false,
            upgradedFromContent: false,
          },
        })
      )
    if (p.startsWith('/api/tasks/resolve/'))
      return new Response(JSON.stringify({ id: 'ctask', identifier: 'LUM-42' }))
    return new Response(JSON.stringify({}))
  })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

describe('flag classification', () => {
  it('tells field changes from relation changes', () => {
    expect(hasFieldChange({ title: 'x' })).toBe(true)
    expect(hasFieldChange({ addTag: [] })).toBe(false)
    expect(hasRelationChange({ addTask: ['LUM-1'] })).toBe(true)
    expect(hasRelationChange({ addMember: [] })).toBe(false)
  })
  it('--role needs --add-member and a known role', () => {
    expect(relationUsageError({ role: 'editor' })).toBe(
      '--role goes with --add-member'
    )
    expect(relationUsageError({ role: 'owner', addMember: ['a'] })).toMatch(
      /invalid role/
    )
    expect(relationUsageError({ role: 'EDITOR', addMember: ['a'] })).toBeNull()
  })
})

describe('doc update with relation flags', () => {
  it('only relation flags: no document PATCH, one call per flag', async () => {
    const code = await docUpdateWithRelations('RFC', {
      addMember: ['alice@x.test'],
      role: 'editor',
      addTask: ['LUM-42'],
    })
    expect(code).toBeUndefined()
    const c = calls()
    expect(c).toContain('POST /api/documents/cdoc1/shares')
    expect(c).toContain('POST /api/documents/cdoc1/mentions')
    expect(c.some(x => x.startsWith('PATCH /api/documents/cdoc1'))).toBe(false)
    const share = fetchMock.mock.calls.find(
      x =>
        String(x[0]).endsWith('/shares') &&
        (x[1] as RequestInit)?.method === 'POST'
    )!
    expect(JSON.parse((share[1] as RequestInit).body as string)).toEqual({
      memberId: 'm1',
      role: 'EDITOR',
    })
  })

  it('a bad --role is a usage error before any request', async () => {
    expect(await docUpdateWithRelations('RFC', { role: 'editor' })).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('doc show --members', () => {
  it('prints the share list and refuses --raw / --section / --json', async () => {
    expect(await docShowWithMembers('RFC', { members: true })).toBeUndefined()
    expect(calls()).toContain('GET /api/documents/cdoc1/shares')
    for (const extra of [{ raw: true }, { section: 'S' }, { json: true }])
      expect(await docShowWithMembers('RFC', { members: true, ...extra })).toBe(
        2
      )
  })
})

describe('removed doc commands are tombstones', () => {
  const values = new Set(['--role', '--scope', '--task', '--gdoc'])
  const takesValue = (_p: string, f: string) => values.has(f)
  it.each([
    [
      ['doc', 'share', 'RFC', 'alice@x.test', '--role', 'editor'],
      'lumo doc update RFC --add-member alice@x.test --role editor',
    ],
    [
      ['doc', 'unshare', 'RFC', 'alice@x.test'],
      'lumo doc update RFC --remove-member alice@x.test',
    ],
    [['doc', 'share-list', 'RFC'], 'lumo doc show RFC --members'],
    [
      ['doc', 'bind', 'cdoc1', 'LUM-42'],
      'lumo doc update cdoc1 --add-task LUM-42',
    ],
    [
      ['doc', 'unbind', 'cdoc1', 'LUM-42'],
      'lumo doc update cdoc1 --remove-task LUM-42',
    ],
    [
      ['doc', 'import-gdoc', 'https://docs.google.com/d/x', '--task', 'LUM-1'],
      'lumo doc import --gdoc https://docs.google.com/d/x --task LUM-1',
    ],
  ])('%j → %s', (argv, replacement) => {
    expect(findRemovedCommand(argv, takesValue)?.replacement).toBe(replacement)
  })

  it('the grammar has the new shape and none of the old commands', () => {
    const grammar = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
        'utf8'
      )
    ) as { commands: Record<string, { flags: Record<string, unknown> }> }
    for (const p of [
      'doc share',
      'doc unshare',
      'doc share-list',
      'doc bind',
      'doc unbind',
      'doc import-gdoc',
    ])
      expect(grammar.commands).not.toHaveProperty([p])
    expect(Object.keys(grammar.commands['doc update']!.flags)).toEqual(
      expect.arrayContaining([
        '--add-member',
        '--remove-member',
        '--role',
        '--add-task',
        '--remove-task',
      ])
    )
    expect(grammar.commands['doc show']!.flags).toHaveProperty(['--members'])
    expect(grammar.commands['doc import']!.flags).toHaveProperty(['--gdoc'])
  })
})
