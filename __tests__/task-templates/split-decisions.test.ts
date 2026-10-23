/**
 * @jest-environment node
 *
 * LUM-1303: the backfill takes the LUM-970 `## Decisions` section out of a
 * description and turns each line into a decision.
 */
import { splitDecisionsSection } from '@/lib/task-templates/decisions'

describe('splitDecisionsSection', () => {
  it('returns null when there is no Decisions section (or no description)', () => {
    expect(splitDecisionsSection('<p>body</p>')).toBeNull()
    expect(splitDecisionsSection(null)).toBeNull()
  })

  it('moves dated list items out and leaves the rest byte-for-byte', () => {
    const html =
      '<h2>Goal</h2><p>g</p><h2>Decisions</h2><ul><li><p>2026-10-04 keep <code>v1</code></p></li><li><p>no date here</p></li></ul>'
    expect(splitDecisionsSection(html)).toEqual({
      description: '<h2>Goal</h2><p>g</p>',
      decisions: [
        { text: 'keep `v1`', date: new Date(Date.UTC(2026, 9, 4, 12)) },
        { text: 'no date here', date: null },
      ],
    })
  })

  it('stops at the next heading of the same level and keeps what follows', () => {
    const html =
      '<h2>Decisions</h2><ul><li><p>a</p></li></ul><h2>Notes</h2><table><tr><td>x</td></tr></table>'
    const out = splitDecisionsSection(html)
    expect(out?.description).toBe(
      '<h2>Notes</h2><table><tr><td>x</td></tr></table>'
    )
    expect(out?.decisions.map(d => d.text)).toEqual(['a'])
  })

  it('matches the heading case-insensitively at any level; a deeper heading stays inside (its title is not a decision)', () => {
    const out = splitDecisionsSection(
      '<h3>decisions</h3><p>use <a href="https://x.test/a">spec</a></p><h4>sub</h4><ul><li>b</li></ul>'
    )
    expect(out?.description).toBe('')
    expect(out?.decisions.map(d => d.text)).toEqual([
      'use [spec](https://x.test/a)',
      'b',
    ])
  })

  it('drops the empty template hint, so an untouched template section yields no decisions', () => {
    const out = splitDecisionsSection(
      '<p>x</p><h2>Decisions</h2><p><em>Dated rulings, appended as work goes with <code>lumo task decide &lt;id&gt; "…"</code>.</em></p>'
    )
    expect(out).toEqual({ description: '<p>x</p>', decisions: [] })
  })
})
