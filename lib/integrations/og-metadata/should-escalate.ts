// lib/integrations/og-metadata/should-escalate.ts
//
// Decide whether a fast-fetch failure justifies escalating to the Chromium
// fallback. Conservative: only signals that plausibly mean "real browser
// might succeed" return true.
export function shouldEscalateToChromium(fastError: string): boolean {
  return (
    fastError === 'http 403' ||
    fastError === 'non-html content' ||
    fastError === 'timeout'
  )
}
