/**
 * @jest-environment node
 *
 * LUM-1233 batch 3e (Q7) — one `usage` noun. `cost` and `report` became
 * `usage show` (`report` = `usage show --by member --tasks`); `usage resync`
 * writes when run, `--dry-run` previews, `--apply` is a tombstone. Also the
 * 3d follow-up: `pr scan --limit=N` / `--repo=X` keep their values.
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
import { usageShow, usageShowError } from '@/cli/src/commands/usage'
import { resolveCostWindow } from '@/cli/src/commands/cost'
import { resolveReportWindow } from '@/cli/src/commands/report'
import {
  findRemovedCommand,
  prScanReplacement,
} from '@/cli/src/lib/removed-commands'
import { CODEX_SERVER_ONLY_COMMANDS } from '@/cli/src/lib/codex-rules'

let fetchMock: jest.Mock
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ version: 1 }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

const url = () => new URL(fetchMock.mock.calls[0]![0] as string)

describe('usage show', () => {
  it('without --tasks reads the per-operation cost', async () => {
    await usageShow({ task: 'LUM-42', by: 'model', json: true })
    expect(url().pathname).toBe('/api/cost')
    expect(url().searchParams.get('task')).toBe('LUM-42')
  })

  it('--by member --tasks reads the window summary with its filters', async () => {
    await usageShow({
      by: 'member',
      tasks: true,
      since: '2026-10-01',
      until: '2026-10-07',
      project: 'Lumo',
      limit: '5',
      json: true,
    })
    expect(url().pathname).toBe('/api/report')
    expect(url().searchParams.get('limit')).toBe('5')
    expect(url().searchParams.get('project')).toBe('Lumo')
  })

  it('--until bounds the per-operation window too', async () => {
    await usageShow({ since: '2026-10-01', until: '2026-10-07', json: true })
    const u = url()
    expect(u.pathname).toBe('/api/cost')
    expect(new Date(u.searchParams.get('until')!).getTime()).toBe(
      new Date(2026, 9, 8).getTime()
    )
    expect(new Date(u.searchParams.get('since')!).getTime()).toBe(
      new Date(2026, 9, 1).getTime()
    )
  })

  it.each([
    [{ by: 'colour' }, /invalid --by/],
    [{ task: 'LUM-1', session: 's' }, /one of --task or --session/],
    [{ tasks: true, task: 'LUM-1' }, /--task does not go with --tasks/],
    [{ tasks: true, by: 'model' }, /--by takes only member/],
    [{ member: 'me' }, /--member goes with --tasks/],
    [{ project: 'Lumo' }, /--project goes with --tasks/],
    [{ limit: '5' }, /--limit goes with --tasks/],
    [{ task: 'LUM-1', since: '2026-10-01' }, /--since does not go with --task/],
    [{ session: 's', until: 'today' }, /--until does not go with --session/],
  ])('%j is a usage error (exit 2, no request)', async (opts, msg) => {
    expect(usageShowError(opts)).toMatch(msg)
    expect(await usageShow(opts)).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the documented forms', () => {
    expect(usageShowError({})).toBeNull()
    expect(usageShowError({ by: 'Member', tasks: true })).toBeNull()
    expect(usageShowError({ tasks: true, member: 'me' })).toBeNull()
    expect(usageShowError({ since: '7d', until: 'yesterday' })).toBeNull()
  })
})

describe('usage show window', () => {
  const now = new Date(2026, 9, 18, 12)
  it('keeps --since alone open-ended (day or timestamp)', () => {
    const w = resolveCostWindow({ since: '2026-10-01' }, now)
    expect(w).toEqual({
      ok: true,
      since: { iso: new Date(2026, 9, 1).toISOString(), day: '2026-10-01' },
    })
  })
  it('--until alone is the 30 days ending on it', () => {
    const w = resolveCostWindow({ until: '2026-10-10' }, now)
    expect(w.ok && w.since?.day).toBe('2026-09-11')
    expect(w.ok && w.untilDay).toBe('2026-10-10')
  })
  it('--since 7d is whole local days ending today', () => {
    const w = resolveCostWindow({ since: '7d' }, now)
    expect(w.ok && w.since?.day).toBe('2026-10-12')
    expect(w.ok && w.untilIso).toBe(new Date(2026, 9, 19).toISOString())
  })
  it('rejects garbage', () => {
    expect(resolveCostWindow({ since: 'soon' }, now).ok).toBe(false)
  })
  it('the --tasks window still defaults to 7 days', () => {
    const r = resolveReportWindow({}, now)
    expect(r.ok && r.window.sinceDay).toBe('2026-10-12')
  })
})

describe('tombstones', () => {
  it.each([
    [['cost'], 'lumo usage show'],
    [
      ['cost', '--task', 'LUM-42', '--by', 'model'],
      'lumo usage show --task LUM-42 --by model',
    ],
    [['report'], 'lumo usage show --by member --tasks'],
    [
      ['report', '--since', '30d', '--member', 'me', '--json'],
      'lumo usage show --by member --tasks --since 30d --member me --json',
    ],
    [['usage', 'resync', '--apply'], 'lumo usage resync'],
    [['usage', 'resync', '--apply', '--json'], 'lumo usage resync --json'],
  ])('%j → %s', (argv, replacement) => {
    const hit = findRemovedCommand(argv, (_p, f) =>
      ['--task', '--by', '--since', '--member'].includes(f)
    )
    expect(hit?.replacement).toBe(replacement)
  })

  it('usage resync without --apply is live', () => {
    expect(findRemovedCommand(['usage', 'resync'])).toBeNull()
    expect(findRemovedCommand(['usage', 'resync', '--dry-run'])).toBeNull()
    expect(findRemovedCommand(['usage', 'show', '--tasks'])).toBeNull()
  })

  it('pr scan keeps --limit=N and --repo=X values (3d follow-up)', () => {
    expect(prScanReplacement(['7'], ['--resume', '--limit=3'])).toBe(
      'lumo pr review 7 --resume --limit 3'
    )
    expect(prScanReplacement(['7'], ['--repo=o/r', '--review=full'])).toBe(
      'lumo pr review 7 --repo o/r --full'
    )
    expect(prScanReplacement(['7'], ['--repo=o/r', '--all'])).toBe(
      'lumo pr show 7 --repo o/r --all'
    )
  })
})

describe('grammar and Codex rules', () => {
  const grammar = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
      'utf8'
    )
  ) as { commands: Record<string, { flags: Record<string, unknown> }> }

  it('has usage show and usage resync --dry-run, no cost / report / --apply', () => {
    expect(grammar.commands).not.toHaveProperty(['cost'])
    expect(grammar.commands).not.toHaveProperty(['report'])
    expect(Object.keys(grammar.commands['usage show']!.flags).sort()).toEqual(
      [
        '--by',
        '--json',
        '--limit',
        '--member',
        '--project',
        '--session',
        '--since',
        '--task',
        '--tasks',
        '--until',
      ].sort()
    )
    expect(Object.keys(grammar.commands['usage resync']!.flags).sort()).toEqual(
      ['--dry-run', '--json']
    )
  })

  it('usage show runs outside the Codex sandbox; cost / report are gone', () => {
    expect(CODEX_SERVER_ONLY_COMMANDS).toContain('usage show')
    expect(CODEX_SERVER_ONLY_COMMANDS).not.toContain('cost')
    expect(CODEX_SERVER_ONLY_COMMANDS).not.toContain('report')
  })
})
