# Design System Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable, dev-only `/design-system` route that visualizes every design token (color/typography/elevation/radius/motion/spacing) and the all variants of the real UI components (Button, Badge, Input, Typography, AgentStatusBadge), in both light and dark mode.

**Architecture:** A server-component route (`app/design-system/page.tsx`) gated to non-production that renders a client `<DesignSystemCatalog>`. The catalog is composed of small focused section components fed by a single plain-data token registry (`components/design-system/data/tokens.ts`). A `__tests__/styles/` guard asserts the registry stays in sync with `globals.css`'s `--color-*` tokens so the catalog can't silently drift. Dark mode is inherited from the root `next-themes` provider; a toggle flips it.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript (strict), Tailwind v4, next-themes, Jest + @testing-library/react (jsdom).

---

## File Structure

```
app/design-system/page.tsx                          # CREATE — dev-only route, notFound() in prod
components/design-system/
  DesignSystemCatalog.tsx                            # CREATE — 'use client' shell: theme toggle + nav + sections
  data/tokens.ts                                     # CREATE — plain-data token registry (single enumeration)
  primitives/Section.tsx                             # CREATE — anchored titled section
  primitives/Swatch.tsx                              # CREATE — color chip (name + class + computed value)
  primitives/VariantGrid.tsx                         # CREATE — labeled variant grid
  sections/ColorTokens.tsx                           # CREATE
  sections/TypographyScale.tsx                       # CREATE
  sections/Elevation.tsx                             # CREATE
  sections/Motion.tsx                                # CREATE
  sections/Spacing.tsx                               # CREATE
  sections/Buttons.tsx                               # CREATE
  sections/Badges.tsx                                # CREATE
  sections/Inputs.tsx                                # CREATE
  sections/StatusAndPriority.tsx                     # CREATE
__tests__/styles/design-system-catalog-parity.test.ts   # CREATE — globals.css --color-* ⊆ registry
__tests__/components/DesignSystemCatalog.test.tsx        # CREATE — render guard + dev-only gate
```

Reference patterns (read before writing):
- `__tests__/styles/token-parity.test.ts` — `blockBody()` / comment-stripping for parsing `globals.css`.
- `__tests__/components/MilestoneOverviewTab.test.tsx` — `/** @jest-environment jsdom */`, mocking, `@testing-library/react`.
- `components/landing/ui/mode-toggle.tsx` — `next-themes` `useTheme()` + `mounted` guard pattern.

---

## Task 1: Token registry + parity guard

**Files:**
- Create: `components/design-system/data/tokens.ts`
- Create: `__tests__/styles/design-system-catalog-parity.test.ts`

- [ ] **Step 1: Write the token registry**

Create `components/design-system/data/tokens.ts`. The `tokens` arrays hold the
utility base-name (the part after `--color-`), so `'primary'` renders as
`bg-primary` etc.

```ts
// Single source for what the design-system catalog renders. Color token names
// are kept in sync with globals.css `@theme inline` by
// __tests__/styles/design-system-catalog-parity.test.ts.

export interface TokenGroup {
  /** Anchor id + nav label. */
  id: string
  title: string
  /** Utility base names: `name` → `bg-${name}` / `text-${name}`. */
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
      'status-done',
    ],
  },
  {
    id: 'color-priority',
    title: 'Priority',
    tokens: ['priority-low', 'priority-medium', 'priority-high', 'priority-urgent'],
  },
  {
    id: 'color-feedback',
    title: 'Feedback',
    tokens: [
      'info',
      'info-foreground',
      'info-border',
      'info-subtle',
      'warning',
      'warning-foreground',
      'warning-border',
      'warning-subtle',
      'success',
      'success-foreground',
      'success-border',
      'success-subtle',
      'danger',
      'danger-foreground',
      'danger-border',
      'danger-subtle',
    ],
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
export const CATALOG_COLOR_TOKENS: string[] = COLOR_GROUPS.flatMap(g => g.tokens)

/** Semantic type-scale tiers (globals.css `--text-*` base tiers). */
export const TYPE_TIERS = [
  'display',
  'heading',
  'title',
  'body',
  'body-strong',
  'caption',
] as const

/** Elevation shadow utilities. */
export const ELEVATIONS = ['elevation-1', 'elevation-2', 'elevation-3'] as const

/** Radius tiers (`rounded-${tier}`). */
export const RADII = ['sm', 'md', 'lg', 'xl'] as const

/** Control height + inset insets (`h-control-*` / `px-control-inset-*`). */
export const CONTROL_SIZES = ['sm', 'md', 'lg'] as const

/** Motion easing tokens (`--ease-*`) and keyframe animations (`--animate-*`). */
export const EASINGS = ['standard', 'emphasized'] as const
export const ANIMATIONS = ['appear', 'appear-zoom'] as const
```

- [ ] **Step 2: Write the failing parity test**

Create `__tests__/styles/design-system-catalog-parity.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CATALOG_COLOR_TOKENS } from '@/components/design-system/data/tokens'

// LUM-291: the /design-system catalog enumerates tokens in
// components/design-system/data/tokens.ts. This guard keeps that list in sync
// with globals.css so a newly-added color token can't silently be missing from
// the catalog (the whole point of the catalog is to show every token).
//
// Comments are stripped first so a `{`/`}` inside a CSS comment can't corrupt
// the scan (recurring globals.css guard-test hazard — LUM-261).
const css = readFileSync(
  join(__dirname, '../../app/globals.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

// `--color-brand` / `--color-light` are landing-fork brand tokens, scoped to
// `.landing` and not resolvable in the app context — intentionally not shown
// in the app design-system catalog.
const ALLOWLIST = new Set(['brand', 'light'])

/** Every `--color-<name>` registered in the `@theme inline` block. */
function themeColorTokens(): string[] {
  const at = css.indexOf('@theme inline')
  if (at === -1) throw new Error('no @theme inline block in globals.css')
  const body = css.slice(at)
  return [...body.matchAll(/--color-([a-z0-9-]+)\s*:/g)]
    .map(m => m[1] ?? '')
    .filter(name => !ALLOWLIST.has(name))
}

it('every globals.css --color-* token is in the catalog registry', () => {
  const catalog = new Set(CATALOG_COLOR_TOKENS)
  const missing = themeColorTokens().filter(name => !catalog.has(name))
  expect(missing).toEqual([])
})

it('the catalog registry has no token absent from globals.css', () => {
  const theme = new Set(themeColorTokens())
  const stray = CATALOG_COLOR_TOKENS.filter(name => !theme.has(name))
  expect(stray).toEqual([])
})
```

- [ ] **Step 3: Run the parity test**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npx jest __tests__/styles/design-system-catalog-parity.test.ts`
Expected: PASS (registry was built from the exact `@theme inline` set, minus the allowlist). If it fails listing a `missing` token, add it to the matching group in `tokens.ts`; if `stray`, fix the typo in `tokens.ts`.

- [ ] **Step 4: Commit**

```bash
git add components/design-system/data/tokens.ts __tests__/styles/design-system-catalog-parity.test.ts
git commit -m "feat: token registry + globals.css parity guard for catalog [LUM-291]"
```

---

## Task 2: Primitives (Section, Swatch, VariantGrid)

**Files:**
- Create: `components/design-system/primitives/Section.tsx`
- Create: `components/design-system/primitives/Swatch.tsx`
- Create: `components/design-system/primitives/VariantGrid.tsx`

- [ ] **Step 1: Write `Section.tsx`**

```tsx
import type { ReactNode } from 'react'

export function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className='scroll-mt-20 border-b border-border py-10'>
      <h2 className='mb-6 text-title font-semibold text-foreground'>{title}</h2>
      {children}
    </section>
  )
}
```

- [ ] **Step 2: Write `VariantGrid.tsx`**

```tsx
import type { ReactNode } from 'react'

/** A labeled cell — the variant rendered above its name. */
export function VariantCell({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className='flex flex-col items-start gap-2'>
      <div className='flex min-h-12 items-center'>{children}</div>
      <code className='text-caption text-muted-foreground'>{label}</code>
    </div>
  )
}

export function VariantGrid({ children }: { children: ReactNode }) {
  return (
    <div className='flex flex-wrap gap-x-8 gap-y-6'>{children}</div>
  )
}
```

- [ ] **Step 3: Write `Swatch.tsx`**

Resolves the computed color in `useEffect` (never during render — honors the
React Purity rules in CLAUDE.md).

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A color chip for one token. `name` is the utility base name, e.g. `primary`
 * → painted with `bg-primary`. `-foreground` / `border` tokens render as text /
 * border samples so they stay legible.
 */
export function Swatch({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState<string>('')

  useEffect(() => {
    if (!ref.current) return
    setValue(getComputedStyle(ref.current).backgroundColor)
  }, [])

  const isBorder = name.endsWith('-border')
  const isForeground = name.endsWith('-foreground')

  return (
    <div className='flex flex-col gap-1.5'>
      <div
        ref={ref}
        className={cn(
          'size-16 rounded-md border border-border',
          isBorder ? `border-2 border-${name} bg-card` : `bg-${name}`
        )}
      >
        {isForeground ? (
          <span className={cn('flex size-full items-center justify-center text-lg', `text-${name}`)}>
            Aa
          </span>
        ) : null}
      </div>
      <code className='text-caption text-foreground'>{name}</code>
      <code className='text-caption text-muted-foreground'>{value || '—'}</code>
    </div>
  )
}
```

> Note: the dynamic `bg-${name}` / `text-${name}` / `border-${name}` strings are
> all enumerated as literals in `data/tokens.ts` and already emitted by Tailwind
> for the real app, so they are present in the generated CSS (Tailwind scans the
> whole repo). No safelist change is needed.

- [ ] **Step 4: Commit**

```bash
git add components/design-system/primitives/
git commit -m "feat: catalog primitives (Section, Swatch, VariantGrid) [LUM-291]"
```

> These presentational primitives are exercised by the catalog render test in
> Task 5 (Swatch's `useEffect` runs under jsdom), so they need no separate test.

---

## Task 3: Token sections (Color, Typography, Elevation, Motion, Spacing)

**Files:**
- Create: `components/design-system/sections/ColorTokens.tsx`
- Create: `components/design-system/sections/TypographyScale.tsx`
- Create: `components/design-system/sections/Elevation.tsx`
- Create: `components/design-system/sections/Motion.tsx`
- Create: `components/design-system/sections/Spacing.tsx`

- [ ] **Step 1: Write `ColorTokens.tsx`**

```tsx
import { COLOR_GROUPS } from '../data/tokens'
import { Section } from '../primitives/Section'
import { Swatch } from '../primitives/Swatch'

export function ColorTokens() {
  return (
    <Section id='colors' title='Color tokens'>
      <div className='flex flex-col gap-8'>
        {COLOR_GROUPS.map(group => (
          <div key={group.id} id={group.id} className='scroll-mt-20'>
            <h3 className='mb-3 text-body-strong text-foreground'>{group.title}</h3>
            <div className='flex flex-wrap gap-4'>
              {group.tokens.map(name => (
                <Swatch key={name} name={name} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
```

- [ ] **Step 2: Write `TypographyScale.tsx`**

```tsx
import { TYPE_TIERS } from '../data/tokens'
import { Section } from '../primitives/Section'

export function TypographyScale() {
  return (
    <Section id='typography' title='Typography'>
      <div className='flex flex-col gap-5'>
        {TYPE_TIERS.map(tier => (
          <div key={tier} className='flex items-baseline gap-4'>
            <code className='w-28 shrink-0 text-caption text-muted-foreground'>
              text-{tier}
            </code>
            <span className={`text-${tier} text-foreground`}>
              The quick brown fox jumps over the lazy dog
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}
```

- [ ] **Step 3: Write `Elevation.tsx`**

```tsx
import { ELEVATIONS, RADII } from '../data/tokens'
import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

export function Elevation() {
  return (
    <Section id='elevation' title='Elevation & radius'>
      <h3 className='mb-3 text-body-strong text-foreground'>Shadow</h3>
      <VariantGrid>
        {ELEVATIONS.map(name => (
          <VariantCell key={name} label={`shadow-${name}`}>
            <div className={`size-20 rounded-lg bg-card shadow-${name}`} />
          </VariantCell>
        ))}
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>Radius</h3>
      <VariantGrid>
        {RADII.map(tier => (
          <VariantCell key={tier} label={`rounded-${tier}`}>
            <div className={`size-20 border border-border bg-muted rounded-${tier}`} />
          </VariantCell>
        ))}
      </VariantGrid>
    </Section>
  )
}
```

- [ ] **Step 4: Write `Motion.tsx`**

```tsx
import { ANIMATIONS, EASINGS } from '../data/tokens'
import { Section } from '../primitives/Section'

export function Motion() {
  return (
    <Section id='motion' title='Motion'>
      <h3 className='mb-3 text-body-strong text-foreground'>Easing tokens</h3>
      <ul className='mb-8 flex flex-col gap-1'>
        {EASINGS.map(name => (
          <li key={name} className='text-body text-foreground'>
            <code className='text-caption text-muted-foreground'>--ease-{name}</code>
          </li>
        ))}
      </ul>
      <h3 className='mb-3 text-body-strong text-foreground'>Animations</h3>
      <div className='flex flex-wrap gap-8'>
        {ANIMATIONS.map(name => (
          <div key={name} className='flex flex-col items-center gap-2'>
            <div className={`size-16 rounded-md bg-primary animate-${name}`} />
            <code className='text-caption text-muted-foreground'>animate-{name}</code>
          </div>
        ))}
      </div>
    </Section>
  )
}
```

- [ ] **Step 5: Write `Spacing.tsx`**

```tsx
import { CONTROL_SIZES } from '../data/tokens'
import { Section } from '../primitives/Section'

export function Spacing() {
  return (
    <Section id='spacing' title='Spacing & control sizes'>
      <h3 className='mb-3 text-body-strong text-foreground'>
        Control heights (h-control-*)
      </h3>
      <div className='mb-8 flex flex-col gap-3'>
        {CONTROL_SIZES.map(size => (
          <div key={size} className='flex items-center gap-4'>
            <code className='w-28 shrink-0 text-caption text-muted-foreground'>
              h-control-{size}
            </code>
            <div className={`w-40 rounded-md bg-primary h-control-${size}`} />
          </div>
        ))}
      </div>
      <h3 className='mb-3 text-body-strong text-foreground'>
        Inset padding (px-control-inset-*)
      </h3>
      <div className='flex flex-col gap-3'>
        {CONTROL_SIZES.map(size => (
          <div key={size} className='flex items-center gap-4'>
            <code className='w-36 shrink-0 text-caption text-muted-foreground'>
              px-control-inset-{size}
            </code>
            <div className='inline-flex'>
              <span className={`rounded-md bg-muted py-2 px-control-inset-${size}`}>
                inset
              </span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
```

- [ ] **Step 6: Type-check the new sections**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npx tsc --noEmit`
Expected: no errors referencing `components/design-system/`.

- [ ] **Step 7: Commit**

```bash
git add components/design-system/sections/ColorTokens.tsx components/design-system/sections/TypographyScale.tsx components/design-system/sections/Elevation.tsx components/design-system/sections/Motion.tsx components/design-system/sections/Spacing.tsx
git commit -m "feat: token sections (color, type, elevation, motion, spacing) [LUM-291]"
```

---

## Task 4: Component sections (Buttons, Badges, Inputs, StatusAndPriority)

**Files:**
- Create: `components/design-system/sections/Buttons.tsx`
- Create: `components/design-system/sections/Badges.tsx`
- Create: `components/design-system/sections/Inputs.tsx`
- Create: `components/design-system/sections/StatusAndPriority.tsx`

- [ ] **Step 1: Write `Buttons.tsx`**

```tsx
import { Button } from '@/components/ui/button'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

const VARIANTS = [
  'default',
  'destructive',
  'outline',
  'secondary',
  'ghost',
  'link',
] as const
const SIZES = ['default', 'sm', 'lg'] as const

export function Buttons() {
  return (
    <Section id='buttons' title='Button'>
      <h3 className='mb-3 text-body-strong text-foreground'>Variants</h3>
      <VariantGrid>
        {VARIANTS.map(variant => (
          <VariantCell key={variant} label={variant}>
            <Button variant={variant}>Button</Button>
          </VariantCell>
        ))}
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>Sizes</h3>
      <VariantGrid>
        {SIZES.map(size => (
          <VariantCell key={size} label={size}>
            <Button size={size}>Button</Button>
          </VariantCell>
        ))}
        <VariantCell label='icon'>
          <Button size='icon' aria-label='icon button'>
            +
          </Button>
        </VariantCell>
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>Disabled</h3>
      <VariantGrid>
        <VariantCell label='disabled'>
          <Button disabled>Button</Button>
        </VariantCell>
      </VariantGrid>
    </Section>
  )
}
```

- [ ] **Step 2: Write `Badges.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

const VARIANTS = ['default', 'secondary', 'destructive', 'outline'] as const

export function Badges() {
  return (
    <Section id='badges' title='Badge'>
      <VariantGrid>
        {VARIANTS.map(variant => (
          <VariantCell key={variant} label={variant}>
            <Badge variant={variant}>Badge</Badge>
          </VariantCell>
        ))}
      </VariantGrid>
    </Section>
  )
}
```

- [ ] **Step 3: Write `Inputs.tsx`**

```tsx
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

export function Inputs() {
  return (
    <Section id='inputs' title='Form fields'>
      <VariantGrid>
        <VariantCell label='default'>
          <Input placeholder='Placeholder' className='w-56' />
        </VariantCell>
        <VariantCell label='disabled'>
          <Input placeholder='Placeholder' disabled className='w-56' />
        </VariantCell>
        <VariantCell label='aria-invalid'>
          <Input placeholder='Placeholder' aria-invalid className='w-56' />
        </VariantCell>
        <VariantCell label='with label'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='ds-input'>Label</Label>
            <Input id='ds-input' placeholder='Placeholder' className='w-56' />
          </div>
        </VariantCell>
        <VariantCell label='textarea'>
          <Textarea placeholder='Placeholder' className='w-56' />
        </VariantCell>
      </VariantGrid>
    </Section>
  )
}
```

- [ ] **Step 4: Write `StatusAndPriority.tsx`**

```tsx
import { AgentStatusBadge } from '@/components/task/agent/AgentStatusBadge'

import { Section } from '../primitives/Section'
import { VariantCell, VariantGrid } from '../primitives/VariantGrid'

const AGENT_STATUSES = [
  'SUBMITTED',
  'WORKING',
  'INPUT_REQUIRED',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const

const STATUS_TOKENS = [
  'status-todo',
  'status-in-progress',
  'status-in-review',
  'status-done',
] as const

const PRIORITY_TOKENS = [
  'priority-low',
  'priority-medium',
  'priority-high',
  'priority-urgent',
] as const

export function StatusAndPriority() {
  return (
    <Section id='status-priority' title='Status & priority'>
      <h3 className='mb-3 text-body-strong text-foreground'>
        AgentStatusBadge
      </h3>
      <VariantGrid>
        {AGENT_STATUSES.map(status => (
          <VariantCell key={status} label={status}>
            <AgentStatusBadge status={status} />
          </VariantCell>
        ))}
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>
        Status colors
      </h3>
      <VariantGrid>
        {STATUS_TOKENS.map(token => (
          <VariantCell key={token} label={token}>
            <span className='flex items-center gap-2 text-body text-foreground'>
              <span className={`inline-block size-3 rounded-full bg-${token}`} />
              {token.replace('status-', '')}
            </span>
          </VariantCell>
        ))}
      </VariantGrid>
      <h3 className='mt-8 mb-3 text-body-strong text-foreground'>
        Priority colors
      </h3>
      <VariantGrid>
        {PRIORITY_TOKENS.map(token => (
          <VariantCell key={token} label={token}>
            <span className='flex items-center gap-2 text-body text-foreground'>
              <span className={`inline-block size-3 rounded-full bg-${token}`} />
              {token.replace('priority-', '')}
            </span>
          </VariantCell>
        ))}
      </VariantGrid>
    </Section>
  )
}
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npx tsc --noEmit`
Expected: no errors referencing `components/design-system/`.

- [ ] **Step 6: Commit**

```bash
git add components/design-system/sections/Buttons.tsx components/design-system/sections/Badges.tsx components/design-system/sections/Inputs.tsx components/design-system/sections/StatusAndPriority.tsx
git commit -m "feat: component sections (button, badge, input, status/priority) [LUM-291]"
```

---

## Task 5: Catalog shell + theme toggle + render test

**Files:**
- Create: `components/design-system/DesignSystemCatalog.tsx`
- Create: `__tests__/components/DesignSystemCatalog.test.tsx`

- [ ] **Step 1: Write `DesignSystemCatalog.tsx`**

```tsx
'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import { Badges } from './sections/Badges'
import { Buttons } from './sections/Buttons'
import { ColorTokens } from './sections/ColorTokens'
import { Elevation } from './sections/Elevation'
import { Inputs } from './sections/Inputs'
import { Motion } from './sections/Motion'
import { Spacing } from './sections/Spacing'
import { StatusAndPriority } from './sections/StatusAndPriority'
import { TypographyScale } from './sections/TypographyScale'

const NAV = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'motion', label: 'Motion' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'buttons', label: 'Button' },
  { id: 'badges', label: 'Badge' },
  { id: 'inputs', label: 'Form fields' },
  { id: 'status-priority', label: 'Status & priority' },
]

function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])

  if (!mounted) return null

  const next = resolvedTheme === 'dark' ? 'light' : 'dark'
  return (
    <Button variant='outline' size='sm' onClick={() => setTheme(next)}>
      {resolvedTheme === 'dark' ? 'Light' : 'Dark'} mode
    </Button>
  )
}

export function DesignSystemCatalog() {
  return (
    <div className='mx-auto flex max-w-5xl gap-10 px-6 py-10'>
      <nav className='sticky top-10 hidden h-fit w-40 shrink-0 flex-col gap-1 lg:flex'>
        {NAV.map(item => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className='text-body text-muted-foreground hover:text-foreground'
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main className='min-w-0 flex-1'>
        <header className='mb-6 flex items-center justify-between'>
          <h1 className='text-display font-semibold text-foreground'>
            Design System
          </h1>
          <ThemeToggle />
        </header>
        <ColorTokens />
        <TypographyScale />
        <Elevation />
        <Motion />
        <Spacing />
        <Buttons />
        <Badges />
        <Inputs />
        <StatusAndPriority />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Write the failing render test**

Create `__tests__/components/DesignSystemCatalog.test.tsx`:

```tsx
/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

import { DesignSystemCatalog } from '@/components/design-system/DesignSystemCatalog'

// next-themes needs no provider if we stub useTheme.
jest.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: jest.fn() }),
}))

describe('DesignSystemCatalog', () => {
  it('renders the catalog with every section heading', () => {
    render(<DesignSystemCatalog />)
    for (const title of [
      'Color tokens',
      'Typography',
      'Elevation & radius',
      'Motion',
      'Spacing & control sizes',
      'Button',
      'Badge',
      'Form fields',
      'Status & priority',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })

  it('renders real component variants', () => {
    render(<DesignSystemCatalog />)
    // Button section renders multiple "Button" labels; Badge renders "Badge".
    expect(screen.getAllByRole('button', { name: 'Button' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Badge')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the render test**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npx jest __tests__/components/DesignSystemCatalog.test.tsx`
Expected: PASS. If `getByRole('heading', …)` fails, confirm the section title strings match the `Section title=` props exactly.

- [ ] **Step 4: Commit**

```bash
git add components/design-system/DesignSystemCatalog.tsx __tests__/components/DesignSystemCatalog.test.tsx
git commit -m "feat: design-system catalog shell + theme toggle + render test [LUM-291]"
```

---

## Task 6: Dev-only route

**Files:**
- Create: `app/design-system/page.tsx`

- [ ] **Step 1: Write the route**

```tsx
import { notFound } from 'next/navigation'

import { DesignSystemCatalog } from '@/components/design-system/DesignSystemCatalog'

// Dev-only: an internal token/component review surface. Never exposed in
// production (no auth, no workspace data, no need to ship it).
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <DesignSystemCatalog />
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/design-system/page.tsx
git commit -m "feat: dev-only /design-system route [LUM-291]"
```

---

## Task 7: Full verification + browser proof + PR

- [ ] **Step 1: Run the full styles guard suite + new tests**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npx jest __tests__/styles __tests__/components/DesignSystemCatalog.test.tsx`
Expected: all PASS (the broader `__tests__/styles` run confirms no globals.css guard regressed).

- [ ] **Step 2: Type-check the whole project**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Token-lint (no raw colors in the new files)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && npm run lint:tokens`
Expected: passes with the baseline empty (the catalog uses only semantic token utilities). If it flags `bg-${name}`-style dynamic classes, they are token utilities, not raw hex — confirm no literal hex/zinc/gray crept in.

- [ ] **Step 4: Browser verification (preview)**

Start the dev server, open `/design-system`, confirm it renders, flip the theme, screenshot both modes. Use the `preview_*` tools:
- `preview_start`, then navigate to `/design-system`.
- `preview_snapshot` — confirm section headings + component variants present.
- Click the theme toggle (`preview_click`), `preview_snapshot` again — confirm dark mode tokens apply.
- `preview_console_logs` — confirm no React errors.
- `preview_screenshot` — capture light and dark as proof.

- [ ] **Step 5: Push and open the PR**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog
git push -u origin lumo/LUM-291-design-system-catalog
```

Open the PR with title `feat: add dev-only design-system component catalog [LUM-291]`.
PR description MUST state:
- New dev-only route `app/design-system` — `notFound()` in production (not shipped to prod users).
- **No new npm dependencies.**
- New guard test `__tests__/styles/design-system-catalog-parity.test.ts` keeps the catalog's color-token list in sync with `globals.css`.
- Scope note: covers existing components (Button/Badge/Input/Typography/AgentStatusBadge) + status/priority as token swatches. `StatusBadge`/`PriorityBadge`/`Callout` are not standalone UI components today; CI visual regression deferred to a follow-up.

- [ ] **Step 6: Confirm no migration deletions / clean diff vs origin/main**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-291-design-system-catalog && git diff --stat origin/main...HEAD -- prisma/migrations`
Expected: empty (this change touches no migrations; guards against the stale-base false-deletion hazard).

---

## Self-Review Notes

- **Spec coverage:** carrier (Task 6 route, lightweight) ✓; dev-only gate (Task 6) ✓; token galleries — color/type/elevation/radius/motion/spacing (Task 3) ✓; component galleries — Button/Badge/Input/Typography*/AgentStatusBadge (Task 4 + TypographyScale in Task 3) ✓; theme toggle (Task 5) ✓; token-parity guard (Task 1) ✓; render test (Task 5) ✓; scope correction — status/priority as swatches, no fabricated components (Task 4) ✓; no new deps + PR notes (Task 7) ✓; CI visual regression out of scope (not in plan) ✓.
- **Note:** `TypographyScale` shows the raw `text-*` tiers; the `Typography*` React components in `components/ui/typography.tsx` are thin wrappers over these tiers, so the tiers section covers the type scale the spec asked for without a redundant component gallery.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `CATALOG_COLOR_TOKENS`, `COLOR_GROUPS`, `TYPE_TIERS`, `ELEVATIONS`, `RADII`, `CONTROL_SIZES`, `EASINGS`, `ANIMATIONS` defined in Task 1 and consumed with matching names/shapes in Tasks 3–4. `Section`/`Swatch`/`VariantGrid`/`VariantCell` defined in Task 2, consumed consistently after.
```
