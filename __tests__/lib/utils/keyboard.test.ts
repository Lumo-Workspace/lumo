import type { KeyboardEvent } from 'react'
import { isMac, submitModLabel, isSubmitShortcut } from '@/lib/utils/keyboard'

describe('keyboard helpers', () => {
  it('isMac is a boolean', () => {
    expect(typeof isMac).toBe('boolean')
  })

  it('submitModLabel is "⌘" on Mac and "Ctrl" elsewhere', () => {
    expect(submitModLabel).toBe(isMac ? '⌘' : 'Ctrl')
  })
})

describe('isSubmitShortcut', () => {
  function makeEvent(
    overrides: Partial<{
      key: string
      metaKey: boolean
      ctrlKey: boolean
    }>
  ): KeyboardEvent {
    return {
      key: overrides.key ?? 'Enter',
      metaKey: overrides.metaKey ?? false,
      ctrlKey: overrides.ctrlKey ?? false,
    } as KeyboardEvent
  }

  it('returns false when key is not Enter', () => {
    expect(isSubmitShortcut(makeEvent({ key: 'a', metaKey: true }))).toBe(false)
  })

  it('returns true on Enter + correct modifier for current OS', () => {
    const e = makeEvent(isMac ? { metaKey: true } : { ctrlKey: true })
    expect(isSubmitShortcut(e)).toBe(true)
  })

  it('returns false on Enter with no modifier', () => {
    expect(isSubmitShortcut(makeEvent({}))).toBe(false)
  })
})
