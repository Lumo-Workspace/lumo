/** @jest-environment node */
import { renderDecisionsMarkdown } from '@/lib/context/render/decisions'

describe('renderDecisionsMarkdown (LUM-1303 task show --full)', () => {
  it('is empty with no decisions', () => {
    expect(renderDecisionsMarkdown([])).toBe('')
  })

  it("lists them by number as 'Decision N · date', with the rationale on its own line", () => {
    expect(
      renderDecisionsMarkdown([
        {
          number: 1,
          text: 'keep v1',
          rationale: 'v2 is\nits own task',
          createdAt: new Date('2026-10-04T09:00:00Z'),
        },
        {
          number: 3,
          text: 'ship',
          rationale: null,
          createdAt: new Date('2026-10-05T09:00:00Z'),
        },
      ])
    ).toBe(
      '## Decisions\n\n- Decision 1 · 2026-10-04 · keep v1\n  Why: v2 is its own task\n- Decision 3 · 2026-10-05 · ship'
    )
  })
})
