import {
  parseArgs,
  groupDeliveries,
} from '@/scripts/detect-git-outcome-rejections'

describe('detect-git-outcome-rejections — pure helpers', () => {
  it('parseArgs reads flags and coerces limit', () => {
    expect(
      parseArgs(['--dry-run', '--task', 'LUM-601', '--limit', '5'])
    ).toEqual({
      dryRun: true,
      task: 'LUM-601',
      since: null,
      limit: 5,
    })
    expect(parseArgs([])).toEqual({
      dryRun: false,
      task: null,
      since: null,
      limit: null,
    })
  })

  it('groupDeliveries folds multiple merged PRs into one delivery per task', () => {
    const out = groupDeliveries([
      {
        taskId: 't1',
        workspaceId: 'ws1',
        mergeCommitSha: 'aaa',
        task: { number: 601, team: { identifier: 'LUM' } },
      },
      {
        taskId: 't1',
        workspaceId: 'ws1',
        mergeCommitSha: 'bbb',
        task: { number: 601, team: { identifier: 'LUM' } },
      },
      // skipped: no mergeCommitSha
      {
        taskId: 't2',
        workspaceId: 'ws1',
        mergeCommitSha: null,
        task: { number: 7, team: { identifier: 'LUM' } },
      },
    ])
    expect(out).toEqual([
      {
        taskId: 't1',
        workspaceId: 'ws1',
        identifier: 'LUM-601',
        shas: ['aaa', 'bbb'],
      },
    ])
  })
})
