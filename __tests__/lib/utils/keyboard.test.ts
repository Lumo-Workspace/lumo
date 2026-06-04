import type { KeyboardEvent } from 'react'
import {
  isMac,
  submitModLabel,
  isSubmitShortcut,
  detectMac,
} from '@/lib/utils/keyboard'

describe('keyboard helpers', () => {
  it('isMac is a boolean', () => {
    expect(typeof isMac).toBe('boolean')
  })

  it('submitModLabel is "⌘" on Mac and "Ctrl" elsewhere', () => {
    expect(submitModLabel).toBe(isMac ? '⌘' : 'Ctrl')
  })
})

describe('detectMac (no deprecated navigator.platform when modern API present)', () => {
  const realNavigator = globalThis.navigator

  function stubNavigator(value: unknown) {
    Object.defineProperty(globalThis, 'navigator', {
      value,
      configurable: true,
      writable: true,
    })
  }

  afterEach(() => {
    stubNavigator(realNavigator)
  })

  it('prefers userAgentData.platform and detects macOS', () => {
    // `platform` left undefined to prove the modern hint is the signal used.
    stubNavigator({ userAgentData: { platform: 'macOS' } })
    expect(detectMac()).toBe(true)
  })

  it('prefers userAgentData.platform and detects non-Mac', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })
    expect(detectMac()).toBe(false)
  })

  it('falls back to navigator.platform when userAgentData is absent', () => {
    stubNavigator({ platform: 'iPhone' })
    expect(detectMac()).toBe(true)
  })

  it('falls back to navigator.platform for non-Mac when userAgentData is absent', () => {
    stubNavigator({ platform: 'Linux x86_64' })
    expect(detectMac()).toBe(false)
  })

  it('returns false when navigator is undefined (SSR)', () => {
    stubNavigator(undefined)
    expect(detectMac()).toBe(false)
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
