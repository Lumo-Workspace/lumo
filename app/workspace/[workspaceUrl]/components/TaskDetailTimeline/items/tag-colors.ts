/**
 * Categorical tag palette — six fixed Ant-Design hues assigned to inline tag
 * badges deterministically by name hash (see InlineTagBadge). These are
 * decorative category colors, NOT semantic status colors, so the raw hex
 * stops ARE the payload and there is no meaningful token equivalent — same
 * rationale as the icon set. This module is allowlisted in
 * scripts/lint-tokens.ts; keep raw colors confined to it.
 */
export const TAG_COLORS = [
  { bg: '#fff1f0', text: '#f5222d' },
  { bg: '#fff7e6', text: '#fa8c16' },
  { bg: '#fffbe6', text: '#d4a012' },
  { bg: '#f6ffed', text: '#52c41a' },
  { bg: '#e6f7ff', text: '#1890ff' },
  { bg: '#f9f0ff', text: '#722ed1' },
] as const
