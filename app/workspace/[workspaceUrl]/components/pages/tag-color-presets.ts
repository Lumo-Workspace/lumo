/**
 * Tag color presets — a fixed "bright dopamine" palette users pick from when
 * coloring a tag, plus an example value for the custom-hex input. These are
 * categorical/brand colors stored on the tag (the raw hex IS the payload, not
 * a semantic token), so this module is allowlisted in scripts/lint-tokens.ts;
 * keep raw colors confined here.
 */
export const PRESET_COLORS = [
  '#f5222d', // red
  '#fa8c16', // orange
  '#d4a012', // yellow
  '#52c41a', // green
  '#1890ff', // blue
  '#722ed1', // purple
]

/** Placeholder shown in the custom-color (hex) input — illustrative only. */
export const CUSTOM_COLOR_PLACEHOLDER = '#3730a3'
