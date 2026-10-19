/**
 * @jest-environment node
 *
 * LUM-1233 batch 3d (Q8) — `pr scan` became the read-only `pr show`; its
 * write flags moved to `pr review <n> [--full | --pause | --resume]`.
 * `pr scan` is a tombstone that maps each old flag combination to the new
 * command. No `pr show --task`: the task view is `task show --scans`.
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
import {
  prReview,
  prReviewUsageError,
  prShow,
} from '@/cli/src/commands/pr-scan'
import {
  findRemovedCommand,
  prScanReplacement,
} from '@/cli/src/lib/removed-commands'

let fetchMock: jest.Mock
beforeEach(() => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202 })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

const body = () =>
  JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)

describe('pr review', () => {
  it('defaults to an incremental review; --full asks for a full one', async () => {
    await prReview('7', {})
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://lumo.test/api/pull-requests/7/scans'
    )
    expect(body()).toEqual({ action: 'incremental' })
    fetchMock.mockClear()
    await prReview('7', { full: true, repo: 'o/r' })
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://lumo.test/api/pull-requests/7/scans?repo=o%2Fr'
    )
    expect(body()).toEqual({ action: 'full' })
  })

  it('--pause / --resume carry --limit', async () => {
    await prReview('7', { resume: true, limit: '3' })
    expect(body()).toEqual({ action: 'resume', limit: 3 })
  })

  it('rejects conflicting or stray flags before any request (exit 2)', async () => {
    expect(prReviewUsageError({ full: true, pause: true })).toMatch(
      /choose one/
    )
    expect(prReviewUsageError({ limit: '2' })).toMatch(/--limit goes with/)
    expect(prReviewUsageError({ pause: true, limit: '101' })).toMatch(
      /1\.\.100/
    )
    expect(await prReview('7', { pause: true, resume: true })).toBe(2)
    expect(await prReview('x', {})).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('pr show is read-only', () => {
  it('only GETs', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: 1, pullRequest: {}, scans: [] }),
    })
    await prShow('7', { json: true })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method ?? 'GET').toBe('GET')
  })
})

describe('pr scan is a tombstone', () => {
  it.each([
    [['pr', 'scan', '7'], 'lumo pr show 7'],
    [['pr', 'scan', '7', '--full', '--json'], 'lumo pr show 7 --full --json'],
    [
      ['pr', 'scan', '7', '--repo', 'o/r', '--all'],
      'lumo pr show 7 --repo o/r --all',
    ],
    [['pr', 'scan', '7', '--review', 'incremental'], 'lumo pr review 7'],
    [
      ['pr', 'scan', '7', '--repo', 'o/r', '--review', 'full'],
      'lumo pr review 7 --repo o/r --full',
    ],
    [
      ['pr', 'scan', '7', '--resume', '--limit', '2'],
      'lumo pr review 7 --resume --limit 2',
    ],
    [['pr', 'scan', '7', '--pause', '--json'], 'lumo pr review 7 --pause'],
  ])('%j → %s', (argv, replacement) => {
    expect(findRemovedCommand(argv, () => false)?.replacement).toBe(replacement)
  })

  it('prScanReplacement keeps read flags on show', () => {
    expect(prScanReplacement(['9'], ['--all'])).toBe('lumo pr show 9 --all')
  })

  it('the grammar has pr show (read flags only) and pr review, no pr scan', () => {
    const grammar = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
        'utf8'
      )
    ) as { commands: Record<string, { flags: Record<string, unknown> }> }
    expect(grammar.commands).not.toHaveProperty(['pr scan'])
    expect(Object.keys(grammar.commands['pr show']!.flags).sort()).toEqual(
      ['--all', '--full', '--json', '--repo'].sort()
    )
    expect(Object.keys(grammar.commands['pr review']!.flags).sort()).toEqual(
      ['--full', '--limit', '--pause', '--repo', '--resume'].sort()
    )
    expect(grammar.commands).not.toHaveProperty(['pr show --task'])
  })
})
