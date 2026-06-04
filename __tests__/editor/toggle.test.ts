// __tests__/editor/toggle.test.ts
import {
  Toggle,
  ToggleSummary,
  ToggleContent,
  ToggleExtensions,
  parseToggleOpen,
  renderToggleOpenAttr,
} from '@/lib/editor/nodes/toggle'

describe('Toggle nodes', () => {
  it('exposes three nodes with the expected names', () => {
    expect(Toggle.name).toBe('toggle')
    expect(ToggleSummary.name).toBe('toggleSummary')
    expect(ToggleContent.name).toBe('toggleContent')
  })

  it('bundles all three for registration', () => {
    expect(ToggleExtensions).toEqual([Toggle, ToggleSummary, ToggleContent])
  })

  it('parses data-open: only the string "false" is collapsed', () => {
    expect(parseToggleOpen('true')).toBe(true)
    expect(parseToggleOpen('false')).toBe(false)
    expect(parseToggleOpen(null)).toBe(true) // default open
  })

  it('renders the open attr round-trippably', () => {
    expect(renderToggleOpenAttr(true)).toEqual({ 'data-open': 'true' })
    expect(renderToggleOpenAttr(false)).toEqual({ 'data-open': 'false' })
  })
})
