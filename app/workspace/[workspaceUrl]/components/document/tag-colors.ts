/**
 * Document tag color palettes. A tag's color is payload (stored on the tag /
 * hashed from its name and written into inline styles), not a CSS token, so
 * the raw hex IS the data. This module is allowlisted in scripts/lint-tokens.ts;
 * keep raw colors confined here.
 */

export interface TagColor {
  bg: string
  text: string
}

/** Hash palette for display-only tag badges (TagBadge). */
export const TAG_BADGE_COLORS: TagColor[] = [
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#dcfce7', text: '#166534' },
  { bg: '#fef3c7', text: '#92400e' },
  { bg: '#e0e7ff', text: '#3730a3' },
  { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#ffedd5', text: '#9a3412' },
  { bg: '#ccfbf1', text: '#115e59' },
  { bg: '#fee2e2', text: '#991b1b' },
]

/** Default picker palette for tags without an explicit color (TagPicker). */
export const TAG_PICKER_COLORS: TagColor[] = [
  { bg: '#fff1f0', text: '#f5222d' }, // red
  { bg: '#fff7e6', text: '#fa8c16' }, // orange
  { bg: '#fffbe6', text: '#d4a012' }, // yellow
  { bg: '#f6ffed', text: '#52c41a' }, // green
  { bg: '#e6f7ff', text: '#1890ff' }, // blue
  { bg: '#f9f0ff', text: '#722ed1' }, // purple
]
