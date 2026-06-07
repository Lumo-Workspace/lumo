/**
 * Rich-text editor font / highlight color palettes. Users pick from these and
 * the chosen hex is written into the document (TipTap mark attributes) — a
 * payload value, not a CSS token, so the raw hex IS the data. This module is
 * allowlisted in scripts/lint-tokens.ts; keep raw colors confined here.
 */

export interface EditorColor {
  label: string
  value: string
}

export const FONT_COLORS: EditorColor[] = [
  { label: 'Default', value: '' },
  { label: 'Gray', value: '#8c8c8c' },
  { label: 'Red', value: '#d83931' },
  { label: 'Orange', value: '#de7802' },
  { label: 'Yellow', value: '#dc9b04' },
  { label: 'Green', value: '#21a121' },
  { label: 'Blue', value: '#245bdb' },
  { label: 'Purple', value: '#6425d0' },
]

export const BG_COLORS_LIGHT: EditorColor[] = [
  { label: 'None', value: '' },
  { label: 'Light Red', value: '#fde8e8' },
  { label: 'Light Orange', value: '#fef0e1' },
  { label: 'Light Yellow', value: '#fefce8' },
  { label: 'Light Green', value: '#e8fde8' },
  { label: 'Light Blue', value: '#e8f0fe' },
  { label: 'Light Purple', value: '#f0e8fe' },
]

export const BG_COLORS_DARK: EditorColor[] = [
  { label: 'Gray', value: '#e2e2e2' },
  { label: 'Red', value: '#f9b4b4' },
  { label: 'Orange', value: '#fdd09b' },
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Green', value: '#b4f9b4' },
  { label: 'Blue', value: '#b4d0fe' },
  { label: 'Purple', value: '#d0b4fe' },
]
