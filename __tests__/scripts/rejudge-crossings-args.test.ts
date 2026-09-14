/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({ prisma: { $disconnect: jest.fn() } }))
jest.mock('@/lib/services/boundary-crossing-rejudge.service', () => ({
  boundaryCrossingRejudgeService: { sweep: jest.fn() },
}))

import { parseArgs } from '@/scripts/rejudge-crossings'

describe('scripts/rejudge-crossings parseArgs (LUM-780)', () => {
  it('defaults to a capped dry-run', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      limit: 200,
      taskId: null,
      sourceFile: null,
    })
  })
  it('reads --apply, --limit, --task and --source-file', () => {
    expect(
      parseArgs([
        '--apply',
        '--limit',
        '50',
        '--task',
        't1',
        '--source-file',
        'CLAUDE.md',
      ])
    ).toEqual({ apply: true, limit: 50, taskId: 't1', sourceFile: 'CLAUDE.md' })
  })
  it('rejects a bad limit, a missing value and an unknown flag', () => {
    expect(() => parseArgs(['--limit', '0'])).toThrow('positive integer')
    expect(() => parseArgs(['--task'])).toThrow('--task expects')
    expect(() => parseArgs(['--source-file', '--apply'])).toThrow(
      '--source-file expects'
    )
    expect(() => parseArgs(['--nope'])).toThrow('unknown argument')
  })
})
