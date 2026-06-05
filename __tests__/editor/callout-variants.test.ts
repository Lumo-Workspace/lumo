// __tests__/editor/callout-variants.test.ts
import {
  CALLOUT_VARIANTS,
  CALLOUT_VARIANT_KEYS,
  getCalloutVariant,
  isCalloutVariantKey,
} from '@/lib/editor/nodes/callout-variants'

describe('callout variants config', () => {
  it('defines exactly the five agreed variants in order', () => {
    expect(CALLOUT_VARIANT_KEYS).toEqual([
      'info',
      'warning',
      'success',
      'note',
      'error',
    ])
    expect(CALLOUT_VARIANTS).toHaveLength(5)
  })

  it('maps each variant to an emoji and an i18n label id', () => {
    expect(getCalloutVariant('warning')).toEqual({
      key: 'warning',
      emoji: '⚠️',
      labelId: 'editor.callout.variant.warning',
    })
    expect(getCalloutVariant('info').emoji).toBe('💡')
    expect(getCalloutVariant('success').emoji).toBe('✅')
    expect(getCalloutVariant('note').emoji).toBe('📝')
    expect(getCalloutVariant('error').emoji).toBe('❌')
  })

  it('falls back to "info" for unknown / undefined values', () => {
    expect(getCalloutVariant('bogus').key).toBe('info')
    expect(getCalloutVariant(undefined).key).toBe('info')
    expect(getCalloutVariant(null).key).toBe('info')
  })

  it('isCalloutVariantKey guards correctly', () => {
    expect(isCalloutVariantKey('error')).toBe(true)
    expect(isCalloutVariantKey('nope')).toBe(false)
    expect(isCalloutVariantKey(undefined)).toBe(false)
  })
})
