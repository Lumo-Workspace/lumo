import {
  parseArgs,
  buildDeliveryShaIndex,
  resolveDeliveries,
} from '@/scripts/detect-git-outcome-rejections'

const FS = '\x1f'

describe('detect-git-outcome-rejections — pure helpers', () => {
  it('parseArgs reads flags and coerces limit', () => {
    expect(
      parseArgs(['--dry-run', '--task', 'LUM-601', '--limit', '5'])
    ).toEqual({
      dryRun: true,
      task: 'LUM-601',
      since: null,
      limit: 5,
      deep: false,
    })
    expect(parseArgs([])).toEqual({
      dryRun: false,
      task: null,
      since: null,
      limit: null,
      deep: false,
    })
    expect(parseArgs(['--deep']).deep).toBe(true)
  })

  it('buildDeliveryShaIndex maps PR number to the squash commit whose subject ends with (#N)', () => {
    const log = [
      `7930b19b${FS}chore: 收口 LLM model id [LUM-587] (#715)`,
      // A Revert quotes "(#715)" but its subject ends with a quote — not a
      // delivery commit for #715 (573 red line: topology, not wording).
      `aee920c6${FS}Revert "chore: 收口 LLM model id [LUM-587] (#715)"`,
      `e85ad68b${FS}chore: 恢复 LUM-587 [LUM-587] (#716)`,
      // No PR suffix → not indexed.
      `deadbeef${FS}Revert "chore: prohibit Co-Authored-By lines"`,
    ].join('\n')
    const index = buildDeliveryShaIndex(log)
    expect(index.get(715)).toBe('7930b19b')
    expect(index.get(716)).toBe('e85ad68b')
    expect(index.size).toBe(2)
  })

  it('resolveDeliveries prefers mergeCommitSha, falls back to the git index, per PR', () => {
    const index = new Map<number, string>([
      [715, '7930b19b'],
      [716, 'e85ad68b'],
    ])
    const out = resolveDeliveries(
      [
        // mergeCommitSha present → used as-is, index ignored.
        {
          taskId: 't1',
          workspaceId: 'ws1',
          number: 999,
          mergeCommitSha: 'stored999',
          task: { number: 601, team: { identifier: 'LUM' } },
        },
        // null mergeCommitSha, resolvable from the git index (historical).
        {
          taskId: 't2',
          workspaceId: 'ws1',
          number: 715,
          mergeCommitSha: null,
          task: { number: 587, team: { identifier: 'LUM' } },
        },
        // same task, the re-delivery PR — kept as its OWN per-PR delivery, not
        // folded in with #715 (folding would hide the revert).
        {
          taskId: 't2',
          workspaceId: 'ws1',
          number: 716,
          mergeCommitSha: null,
          task: { number: 587, team: { identifier: 'LUM' } },
        },
        // unresolvable: no mergeCommitSha and not in the index → dropped.
        {
          taskId: 't3',
          workspaceId: 'ws1',
          number: 7,
          mergeCommitSha: null,
          task: { number: 7, team: { identifier: 'LUM' } },
        },
      ],
      index
    )
    expect(out).toEqual([
      {
        taskId: 't1',
        workspaceId: 'ws1',
        identifier: 'LUM-601',
        prNumber: 999,
        sha: 'stored999',
      },
      {
        taskId: 't2',
        workspaceId: 'ws1',
        identifier: 'LUM-587',
        prNumber: 715,
        sha: '7930b19b',
      },
      {
        taskId: 't2',
        workspaceId: 'ws1',
        identifier: 'LUM-587',
        prNumber: 716,
        sha: 'e85ad68b',
      },
    ])
  })
})
