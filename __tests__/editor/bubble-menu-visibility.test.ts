import { shouldShowBubble } from '@/lib/editor/bubble-menu-visibility'

const base = {
  editable: true,
  isInTable: false,
  selectionEmpty: false,
  suppressed: false,
}

it('shows for a non-empty selection in editable content', () => {
  expect(shouldShowBubble(base)).toBe(true)
})

it('hides for an empty selection', () => {
  expect(shouldShowBubble({ ...base, selectionEmpty: true })).toBe(false)
})

it('shows inside a table even with an empty selection', () => {
  expect(
    shouldShowBubble({ ...base, isInTable: true, selectionEmpty: true })
  ).toBe(true)
})

it('hides when the editor is not editable', () => {
  expect(shouldShowBubble({ ...base, editable: false })).toBe(false)
})

it('hides when suppressed, even with a non-empty selection', () => {
  expect(shouldShowBubble({ ...base, suppressed: true })).toBe(false)
})

it('hides when suppressed, even inside a table', () => {
  expect(shouldShowBubble({ ...base, suppressed: true, isInTable: true })).toBe(
    false
  )
})
