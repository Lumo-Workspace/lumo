/**
 * @jest-environment node
 *
 * LUM-1233 batch 3a — `task testcase` and `milestone testcase` are one command
 * set: the same verbs and flags (grammar), one `<parent>/TC<n>` handle
 * (milestones by slug), `rm` → `delete`. The removed spellings are tombstones:
 * exit 2 with the replacement, never run, not in the grammar.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
const boundMock = jest.fn()
jest.mock('@/cli/src/lib/resolve-bound-task', () => ({
  resolveBoundTaskIdentifier: (...a: unknown[]) => boundMock(...a),
}))

import fs from 'fs'
import path from 'path'
import {
  exampleHandle,
  parseHandle,
  testCaseList,
  testCaseRun,
  testCaseShow,
} from '@/cli/src/commands/testcase'
import { findRemovedCommand } from '@/cli/src/lib/removed-commands'

const VERBS = [
  'add',
  'list',
  'show',
  'download',
  'update',
  'delete',
  'run',
  'disposition',
]
const grammar = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
    'utf8'
  )
) as {
  commands: Record<
    string,
    { arguments: { name: string }[]; flags: Record<string, unknown> }
  >
}

describe('one command set for both parents (grammar)', () => {
  it.each(VERBS)('%s has the same flags on task and milestone', verb => {
    const t = grammar.commands[`task testcase ${verb}`]!
    const m = grammar.commands[`milestone testcase ${verb}`]!
    expect(Object.keys(m.flags).sort()).toEqual(Object.keys(t.flags).sort())
  })

  it('per-case verbs take one handle; rm is gone', () => {
    for (const verb of ['show', 'update', 'delete', 'run', 'disposition']) {
      expect(grammar.commands[`task testcase ${verb}`]!.arguments).toEqual([
        expect.objectContaining({ name: 'task/case' }),
      ])
      expect(grammar.commands[`milestone testcase ${verb}`]!.arguments).toEqual(
        [expect.objectContaining({ name: 'milestone/case' })]
      )
    }
    expect(grammar.commands).not.toHaveProperty(['task testcase rm'])
    expect(grammar.commands).not.toHaveProperty(['milestone testcase rm'])
  })
})

describe('handle parsing', () => {
  it('splits <parent>/TC<n> for both parents', () => {
    expect(parseHandle('task', 'LUM-42/TC3', 'u')).toEqual({
      parent: 'LUM-42',
      caseRef: 'TC3',
    })
    expect(parseHandle('milestone', 'headless-web-cli/TC3', 'u')).toEqual({
      parent: 'headless-web-cli',
      caseRef: 'TC3',
    })
    expect(exampleHandle('milestone')).toBe('headless-web-cli/TC3')
  })
})

describe('shared bodies', () => {
  let fetchMock: jest.Mock
  let err: string
  beforeEach(() => {
    err = ''
    boundMock.mockReset()
    jest.spyOn(console, 'error').mockImplementation(s => {
      err += String(s) + '\n'
    })
    jest.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock = jest.fn(async (url: string) => {
      if (/\/api\/projects\/[^/]+\/milestones/.test(url))
        return new Response(
          JSON.stringify({
            milestones: [
              { id: 'm-1', name: 'Headless', slug: 'headless-web-cli' },
            ],
          })
        )
      if (/\/api\/projects(\?|$)/.test(url))
        return new Response(
          JSON.stringify({
            projects: [
              {
                id: '01234567-89ab-cdef-0123-456789abcdef',
                name: 'p',
                slug: 'p',
              },
            ],
          })
        )
      return new Response(
        JSON.stringify({
          testCase: { number: 3, title: 'T', steps: [], verification: [] },
          runs: [],
          pullRequests: [],
          testCases: [],
          summary: null,
        })
      )
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => jest.restoreAllMocks())

  it('a milestone handle reads the milestone route', async () => {
    // The rendering itself is covered elsewhere; this checks the route.
    await testCaseShow('milestone', 'headless-web-cli/TC3', {}).catch(
      () => undefined
    )
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toContain(
      'https://api.lumo.test/api/milestones/m-1/test-cases/TC3'
    )
  })

  it('a milestone run refuses --pr with exit 2, before any request', async () => {
    const code = await testCaseRun('milestone', 'headless-web-cli/TC3', {
      result: 'pass',
      env: 'local',
      pr: '7',
    } as never)
    expect(code).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a bad handle is a usage error naming the expected shape', async () => {
    expect(await testCaseShow('milestone', 'headless-web-cli', {})).toBe(2)
    expect(err).toContain(
      'Expected <milestone>/TC<n>, e.g. headless-web-cli/TC3'
    )
  })

  it('task list defaults to the bound task; a milestone must be named', async () => {
    boundMock.mockResolvedValueOnce('LUM-9')
    await testCaseList('task', undefined, {})
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/tasks/LUM-9/test-cases')
    expect(await testCaseList('milestone', undefined, {})).toBe(2)
    expect(err).toContain('missing <milestone>')
  })
})

describe('removed spellings are tombstones', () => {
  // Commander's view of value flags on `milestone testcase run`.
  const takesValue = (_p: string, flag: string) =>
    ['--result', '--env', '--commit', '--project', '--note'].includes(flag)
  const cases: Array<[string[], string, string]> = [
    [
      ['task', 'testcase', 'rm', 'LUM-42/TC3'],
      'lumo task testcase rm',
      'lumo task testcase delete LUM-42/TC3',
    ],
    [
      ['milestone', 'testcase', 'rm', 'beta', 'TC2', '--confirm'],
      'lumo milestone testcase rm',
      'lumo milestone testcase delete beta/TC2 --confirm',
    ],
    [
      ['milestone', 'testcase', 'show', 'beta', '3'],
      'lumo milestone testcase show <milestone> <case>',
      'lumo milestone testcase show beta/TC3',
    ],
    [
      [
        'milestone',
        'testcase',
        'run',
        'beta',
        'TC1',
        '--result',
        'pass',
        '--env',
        'production',
      ],
      'lumo milestone testcase run <milestone> <case>',
      'lumo milestone testcase run beta/TC1 --result pass --env production',
    ],
    [
      ['milestone', 'testcase', 'download', 'beta', 'TC1', './ev'],
      'lumo milestone testcase download <milestone> <case> <dir>',
      'lumo milestone testcase download beta/TC1 ./ev',
    ],
  ]
  it.each(cases)('%j', (argv, label, replacement) => {
    const hit = findRemovedCommand(argv, takesValue)
    expect(hit?.label).toBe(label)
    expect(hit?.replacement).toBe(replacement)
  })

  it('the new forms are left alone', () => {
    for (const argv of [
      ['milestone', 'testcase', 'show', 'beta/TC3'],
      [
        'milestone',
        'testcase',
        'run',
        'beta/TC1',
        '--result',
        'pass',
        '--env',
        'local',
      ],
      ['milestone', 'testcase', 'download', 'beta/TC1', './ev'],
      ['task', 'testcase', 'delete', 'LUM-42/TC3'],
    ])
      expect(findRemovedCommand(argv, takesValue)).toBeNull()
  })
})
