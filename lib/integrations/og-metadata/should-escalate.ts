// lib/integrations/og-metadata/should-escalate.ts
//
// Decide whether a fast-fetch failure justifies escalating to the Chromium
// fallback. Signals that plausibly mean "real browser might succeed" return
// true.
//
// History (LUM-62 follow-up):
// - 'body too large' was originally not escalated under the (wrong) reasoning
//   that a large resource can't be made smaller. In reality Chromium parses
//   the rendered DOM, not the raw response, so it isn't bound by our body
//   cap. CNN-class sites hit this regularly.
// - 'empty extraction' was added when sites returning 200 + HTML but no
//   usable OG tags were observed (e.g. guide.michelin.com serves a JS-only
//   shell). Likely a CF challenge page or SPA — Chromium typically resolves
//   both.
export function shouldEscalateToChromium(fastError: string): boolean {
  return (
    fastError === 'http 403' ||
    fastError === 'non-html content' ||
    fastError === 'timeout' ||
    fastError === 'body too large' ||
    fastError === 'empty extraction'
  )
}
