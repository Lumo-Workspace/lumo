// lib/editor/nodes/callout-variants.ts

/** The five Callout variants, in menu order. */
export const CALLOUT_VARIANT_KEYS = [
  'info',
  'warning',
  'success',
  'note',
  'error',
] as const

export type CalloutVariantKey = (typeof CALLOUT_VARIANT_KEYS)[number]

export interface CalloutVariant {
  key: CalloutVariantKey
  /** Fixed emoji shown in the gutter; derived from the variant, never stored. */
  emoji: string
  /** react-intl message id for the dropdown label. */
  labelId: string
}

const VARIANTS: Record<CalloutVariantKey, CalloutVariant> = {
  info: { key: 'info', emoji: '💡', labelId: 'editor.callout.variant.info' },
  warning: {
    key: 'warning',
    emoji: '⚠️',
    labelId: 'editor.callout.variant.warning',
  },
  success: {
    key: 'success',
    emoji: '✅',
    labelId: 'editor.callout.variant.success',
  },
  note: { key: 'note', emoji: '📝', labelId: 'editor.callout.variant.note' },
  error: { key: 'error', emoji: '❌', labelId: 'editor.callout.variant.error' },
}

/** Ordered list for rendering the dropdown / iterating variants. */
export const CALLOUT_VARIANTS: readonly CalloutVariant[] =
  CALLOUT_VARIANT_KEYS.map(k => VARIANTS[k])

export const DEFAULT_CALLOUT_VARIANT: CalloutVariantKey = 'info'

export function isCalloutVariantKey(
  value: unknown
): value is CalloutVariantKey {
  return (
    typeof value === 'string' &&
    (CALLOUT_VARIANT_KEYS as readonly string[]).includes(value)
  )
}

/** Resolve any attribute value to a known variant, defaulting to "info". */
export function getCalloutVariant(value: unknown): CalloutVariant {
  return isCalloutVariantKey(value)
    ? VARIANTS[value]
    : VARIANTS[DEFAULT_CALLOUT_VARIANT]
}
