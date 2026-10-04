/**
 * @jest-environment node
 *
 * LUM-970: when the new-task form may swap the description for a template.
 */
import { canReplaceDescriptionSilently } from '@/app/workspace/[workspaceUrl]/components/modals/template-prefill'

describe('canReplaceDescriptionSilently', () => {
  it('an empty description (incl. an empty editor paragraph) is replaced silently', () => {
    expect(canReplaceDescriptionSilently(null, null)).toBe(true)
    expect(canReplaceDescriptionSilently('<p></p>', null)).toBe(true)
  })

  it('an untouched applied template is replaced silently', () => {
    const tpl = '<h2>Goal</h2>\n<p><em>hint</em></p>'
    expect(
      canReplaceDescriptionSilently('<h2>Goal</h2><p><em>hint</em></p>', tpl)
    ).toBe(true)
  })

  it('text the user wrote needs confirmation', () => {
    expect(canReplaceDescriptionSilently('<p>my notes</p>', null)).toBe(false)
    expect(
      canReplaceDescriptionSilently(
        '<h2>Goal</h2><p>ship CSV export</p>',
        '<h2>Goal</h2><p><em>hint</em></p>'
      )
    ).toBe(false)
  })
})
