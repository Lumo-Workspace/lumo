// Single source for what the design-system catalog renders. Color token names
// are kept in sync with globals.css `@theme inline` by
// __tests__/styles/design-system-catalog-parity.test.ts.

export interface TokenGroup {
  /** Anchor id + nav label. */
  id: string
  title: string
  /** Token base names: `name` → `var(--${name})` (see Swatch). */
  tokens: string[]
}

export const COLOR_GROUPS: TokenGroup[] = [
  {
    id: 'color-core',
    title: 'Core palette',
    tokens: [
      'background',
      'foreground',
      'card',
      'card-foreground',
      'popover',
      'popover-foreground',
      'primary',
      'primary-foreground',
      'secondary',
      'secondary-foreground',
      'muted',
      'muted-foreground',
      'accent',
      'accent-foreground',
      'destructive',
      'destructive-foreground',
      'border',
      'input',
      'ring',
    ],
  },
  {
    id: 'color-status',
    title: 'Status',
    tokens: [
      'status-todo',
      'status-in-progress',
      'status-in-review',
      'status-in-review-subtle',
      'status-in-review-border',
      'status-in-review-text',
      'status-done',
    ],
  },
  {
    id: 'color-priority',
    title: 'Priority',
    tokens: [
      'priority-low',
      'priority-medium',
      'priority-high',
      'priority-urgent',
    ],
  },
  {
    id: 'color-feedback',
    title: 'Feedback',
    tokens: [
      'info',
      'info-foreground',
      'info-border',
      'info-subtle',
      'info-text',
      'warning',
      'warning-foreground',
      'warning-border',
      'warning-subtle',
      'warning-text',
      'success',
      'success-foreground',
      'success-border',
      'success-subtle',
      'success-text',
      'danger',
      'danger-foreground',
      'danger-border',
      'danger-subtle',
      'danger-text',
    ],
  },
  {
    id: 'color-chart',
    title: 'Data viz',
    tokens: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'],
  },
  {
    id: 'color-sidebar',
    title: 'Sidebar',
    tokens: [
      'sidebar',
      'sidebar-foreground',
      'sidebar-primary',
      'sidebar-primary-foreground',
      'sidebar-accent',
      'sidebar-accent-foreground',
      'sidebar-border',
      'sidebar-ring',
    ],
  },
]

/** Flattened color token names — consumed by the parity guard. */
export const CATALOG_COLOR_TOKENS: string[] = COLOR_GROUPS.flatMap(
  g => g.tokens
)

/** Semantic type-scale tiers (globals.css `--text-*` base tiers). */
export const TYPE_TIERS = [
  'display',
  'heading',
  'title',
  'body',
  'body-strong',
  'caption',
] as const

/** Elevation depth tiers (rendered with shadow-elevation-* utilities). */
export const ELEVATIONS = ['elevation-1', 'elevation-2', 'elevation-3'] as const

/** Radius tiers (`rounded-${tier}`). */
export const RADII = ['sm', 'md', 'lg', 'xl'] as const

/** Control height + inset insets (`h-control-*` / `px-control-inset-*`). */
export const CONTROL_SIZES = ['sm', 'md', 'lg'] as const

/** Motion easing tokens (`--ease-*`) and keyframe animations (`--animate-*`). */
export const EASINGS = ['standard', 'emphasized'] as const
export const ANIMATIONS = ['appear', 'appear-zoom'] as const
