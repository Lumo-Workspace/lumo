/**
 * Payload color constants — hex values stored as data (e.g. a tag's color in
 * the DB), not CSS tokens, so they stay raw hex. This module is allowlisted in
 * scripts/lint-tokens.ts; keep payload color literals confined here.
 */

/** Default color for the auto-created Sentry "bug" tag (red). */
export const DEFAULT_BUG_TAG_COLOR = '#ef4444'
