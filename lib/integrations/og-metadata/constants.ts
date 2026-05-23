// lib/integrations/og-metadata/constants.ts

/** Per-request timeout in ms. Applies to each redirect hop too. */
export const TIMEOUT_MS = 5_000

/** Max HTML body bytes we'll read before aborting.
 *
 * 10 MB chosen empirically — cnn.com and several news sites ship >3 MB of
 * inline JS/CSS in their HTML payload. The earlier 3 MB cap caused them to
 * fail with `'body too large'`, which the classifier treated as terminal.
 * Sites that exceed even 10 MB will still fail fast, and `'body too large'`
 * now escalates to Chromium as a final attempt (Chromium parses the rendered
 * DOM, not the raw response body, so it isn't bound by this cap).
 */
export const MAX_BODY_BYTES = 10 * 1024 * 1024

/** Max redirect hops we'll follow. */
export const MAX_REDIRECTS = 5

/** User-Agent sent on outbound fetches. */
export const USER_AGENT = 'Lumo-LinkPreview/1.0'
