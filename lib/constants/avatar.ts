/**
 * Default avatar color (indigo) for coding agents that have no custom
 * `avatarColor` set. This is a payload value — a hex string sent to the
 * client / stored on the actor, not a CSS token — so it stays a raw hex and
 * this module is allowlisted in scripts/lint-tokens.ts. Keep raw colors
 * confined here.
 */
export const DEFAULT_AGENT_AVATAR_COLOR = '#6366f1'
