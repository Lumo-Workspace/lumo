// lib/integrations/og-metadata/constants.ts

/** Per-request timeout in ms. Applies to each redirect hop too. */
export const TIMEOUT_MS = 5_000

/** Max HTML body bytes we'll read before aborting. */
export const MAX_BODY_BYTES = 3 * 1024 * 1024

/** Max redirect hops we'll follow. */
export const MAX_REDIRECTS = 5

/** User-Agent sent on outbound fetches. */
export const USER_AGENT = 'Lumo-LinkPreview/1.0'
