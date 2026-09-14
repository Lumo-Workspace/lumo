/**
 * @jest-environment node
 *
 * LUM-649: the `lumo milestone changelog` renderer — a structured markdown
 * changelog with baseline-annotated headline counts, per-DONE-task sections
 * (merged PRs + claim provenance), and honest explicit lines for the no-PR /
 * no-claim cases. `--json` is a raw passthrough of the structured payload.
 */
import {
  formatMilestoneChangelog,
  renderChangelogOutput,
  type MilestoneChangelogPayload,
} from '@/cli/src/commands/milestone-changelog'

function sampleChangelog(): MilestoneChangelogPayload {
  return {
    milestone: {
      name: 'Agent-Native Milestones',
      state: 'active' as const,
      startDate: '2026-06-01T00:00:00.000Z',
      targetDate: '2026-07-03T00:00:00.000Z',
    },
    headline: {
      tasksShipped: {
        current: 4,
        base: 3,
        spread: { p25: 2, p75: 5 },
        sampleSize: 3,
        band: 'above',
        deltaPct: 33,
        deltaKind: 'magnitude',
      },
      prsMerged: {
        current: 2,
        base: null,
        spread: null,
        sampleSize: 0,
        band: null,
        deltaPct: null,
        deltaKind: 'magnitude',
      },
    },
    entries: [
      {
        identifier: 'LUM-5',
        title: 'Shipped a thing',
        prs: [
          {
            repo: 'lumo/lumo',
            number: 10,
            title: 'PR ten',
            mergeCommitSha: 'abc1234',
          },
          {
            repo: 'lumo/lumo',
            number: 11,
            title: 'PR eleven',
            mergeCommitSha: null,
          },
        ],
        claim: {
          status: 'present',
          text: 'Implemented X because Y is verifiable',
          source: 'RUN_SUMMARY',
          sessionId: 'sess-1',
        },
      },
      {
        identifier: 'LUM-2',
        title: 'Empty claim, no PR',
        prs: [],
        claim: { status: 'empty' },
      },
      {
        identifier: 'LUM-3',
        title: 'Never synthesized',
        prs: [],
        claim: { status: 'unsynthesized' },
      },
    ],
  }
}

describe('milestone changelog renderer', () => {
  test('renders structured changelog markdown and json passthrough', () => {
    const cl = sampleChangelog()
    const md = formatMilestoneChangelog(cl)

    // Milestone header carries name + derived state (LUM-714).
    expect(md).toContain('Agent-Native Milestones')
    expect(md).toContain('(active)')

    // Headline counts are baseline-annotated: a real base shows the base value,
    // delta and band; a null base reads as an explicit "no baseline".
    expect(md).toMatch(/Tasks shipped:.*\b4\b/)
    expect(md).toMatch(/base 3/)
    expect(md).toMatch(/\+33%/)
    expect(md).toMatch(/above/)
    expect(md).toMatch(/PRs merged:.*\b2\b/)
    expect(md).toMatch(/PRs merged:.*no baseline/i)

    // DONE-task section: identifier + title + merged PRs with repo#number and sha.
    expect(md).toContain('LUM-5')
    expect(md).toContain('Shipped a thing')
    expect(md).toContain('lumo/lumo#10')
    expect(md).toContain('abc1234')
    expect(md).toContain('lumo/lumo#11')

    // Claim provenance is tagged with source + session.
    expect(md).toContain('RUN_SUMMARY')
    expect(md).toContain('sess-1')
    expect(md).toContain('Implemented X because Y is verifiable')

    // Honest explicit lines: no-PR task and empty vs unsynthesized claims,
    // never silently dropped and distinguished from each other.
    expect(md).toContain('LUM-2')
    expect(md).toMatch(/no merged PR/i)
    expect(md).toMatch(/no claim recorded/i)
    expect(md).toContain('LUM-3')
    expect(md).toMatch(/not synthesized/i)

    // --json is a raw passthrough of the structured payload, unchanged.
    expect(renderChangelogOutput(cl, { json: true })).toBe(
      JSON.stringify(cl, null, 2)
    )
    // Default (no --json) renders the markdown.
    expect(renderChangelogOutput(cl, {})).toBe(md)
  })
})
