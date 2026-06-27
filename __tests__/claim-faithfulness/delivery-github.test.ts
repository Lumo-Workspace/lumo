/** @jest-environment node */
import {
  numstatFromDiff,
  resolveDeliveryViaGithub,
  type MergedPrRef,
} from '@/lib/claim-faithfulness/delivery-github'

const DIFF_A = [
  'diff --git a/lib/a.ts b/lib/a.ts',
  'index 111..222 100644',
  '--- a/lib/a.ts',
  '+++ b/lib/a.ts',
  '@@ -1,2 +1,3 @@',
  ' context',
  '+added one',
  '-removed one',
].join('\n')

const DIFF_B = [
  'diff --git a/lib/b.ts b/lib/b.ts',
  '--- a/lib/b.ts',
  '+++ b/lib/b.ts',
  '@@ -0,0 +1 @@',
  '+only added',
].join('\n')

describe('numstatFromDiff', () => {
  it('derives changed files and added and deleted line counts from a unified diff', () => {
    const r = numstatFromDiff(`${DIFF_A}\n${DIFF_B}`)
    expect(r.changedFiles).toEqual(['lib/a.ts', 'lib/b.ts'])
    expect(r.additions).toBe(2)
    expect(r.deletions).toBe(1)
  })

  it('does not count the +++/--- file headers as additions or deletions', () => {
    const r = numstatFromDiff(DIFF_A)
    expect(r.additions).toBe(1)
    expect(r.deletions).toBe(1)
  })

  it('counts body lines whose own content begins with ++ or -- (only the @@ hunk body is counted)', () => {
    const diff = [
      'diff --git a/lib/c.ts b/lib/c.ts',
      '--- a/lib/c.ts',
      '+++ b/lib/c.ts',
      '@@ -1,2 +1,2 @@',
      '+++added', // added line whose content is "++added"
      '--removed', // deleted line whose content is "--removed"
    ].join('\n')
    const r = numstatFromDiff(diff)
    expect(r.changedFiles).toEqual(['lib/c.ts'])
    expect(r.additions).toBe(1)
    expect(r.deletions).toBe(1)
  })
})

describe('resolveDeliveryViaGithub', () => {
  const merged: MergedPrRef[] = [
    {
      workspaceId: 'ws1',
      repo: 'acme/app',
      number: 700,
      mergeCommitSha: 'aaa',
      title: 'feat: a [LUM-612] (#700)',
    },
    {
      workspaceId: 'ws1',
      repo: 'acme/app',
      number: 701,
      mergeCommitSha: 'bbb',
      title: 'fix: b [LUM-612] (#701)',
    },
  ]

  it('returns null when the task has no merged PR', async () => {
    const d = await resolveDeliveryViaGithub(
      { identifier: 'LUM-612', mergedPRs: [] },
      {
        fetchDiff: async () => {
          throw new Error('should not fetch')
        },
      }
    )
    expect(d).toBeNull()
  })

  it('builds a TaskDelivery from merged PR diffs', async () => {
    const fetchDiff = jest.fn(async (o: { prNumber: number }) =>
      o.prNumber === 700 ? DIFF_A : DIFF_B
    )
    const d = await resolveDeliveryViaGithub(
      { identifier: 'LUM-612', mergedPRs: merged },
      { fetchDiff }
    )
    expect(d).not.toBeNull()
    expect(d!.identifier).toBe('LUM-612')
    expect(d!.shas).toEqual(['aaa', 'bbb'])
    expect(d!.prNumbers).toEqual([700, 701])
    expect(d!.commitSubjects).toEqual([merged[0]!.title, merged[1]!.title])
    expect(d!.changedFiles).toEqual(['lib/a.ts', 'lib/b.ts'])
    expect(d!.additions).toBe(2)
    expect(d!.deletions).toBe(1)
    expect(fetchDiff).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      fullName: 'acme/app',
      prNumber: 700,
    })
  })

  it('returns null when every PR diff fetch fails (cannot judge)', async () => {
    const d = await resolveDeliveryViaGithub(
      { identifier: 'LUM-612', mergedPRs: merged },
      {
        fetchDiff: async () => {
          throw new Error('403')
        },
      }
    )
    expect(d).toBeNull()
  })
})
