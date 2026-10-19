'use client'

import { useEffect } from 'react'

/**
 * Mirror the active UI locale onto `<html lang>` (LUM-1261). The browser picks
 * CJK glyph forms from `lang` — without it Japanese renders in a Simplified
 * Chinese face and zh-TW gets Simplified forms — and screen readers announce
 * the page in that language. Every locale key in MESSAGES is already a valid
 * BCP 47 tag (en-GB, es-419, zh-TW…), so it is written as-is.
 *
 * Set in an effect, not during render: the root layout server-renders
 * `lang='en'` and the workspace locale is only known after mount, so writing
 * it here avoids a hydration mismatch. The previous value is restored on
 * unmount so leaving a localized subtree (e.g. client navigation to a page
 * without one) does not keep a stale language.
 */
export function DocumentLang({ locale }: { locale: string }) {
  useEffect(() => {
    const html = document.documentElement
    const previous = html.lang
    html.lang = locale
    return () => {
      html.lang = previous
    }
  }, [locale])
  return null
}
