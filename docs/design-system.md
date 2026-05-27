# Design System

Single source of truth for Lumo's visual tokens, components, and utility
conventions. Read this before adding new components or introducing
hard-coded colors / spacing / motion.

**Stack**: Next.js 14 (App Router) · Tailwind CSS **v4** · shadcn/ui
(`new-york` style, neutral base) · Lucide icons.

**Where things live**
| File | Role |
| --- | --- |
| `app/globals.css` | All tokens (`:root`, `.dark`), `@theme inline` registrations, TipTap / mention / scrollbar overrides. Single Tailwind entry. |
| `components/landing/landing.css` | Landing-page-only tokens (`.landing` scope) + `@theme inline` for `bg-brand` / `shadow-mockup`. `@imported` from `app/globals.css`. |
| `components/ui/` | shadcn primitives. Edit here; don't fork. |
| `components/ui/typography.tsx` | The full type scale (H1–H6 + helpers). Use these instead of free-form `<h1>`. |

## Color tokens

All token values are stored as CSS variables on `:root` (light) and `.dark`
and registered in `@theme inline` so Tailwind v4 emits matching utilities
(`bg-card`, `text-muted-foreground`, etc.). **Do not** hard-code hex / rgb
in components — add or extend a token.

### Core palette

| Token                      | Light     | Dark      | Use for                                                 |
| -------------------------- | --------- | --------- | ------------------------------------------------------- |
| `--background`             | `#ffffff` | `#0a0a0a` | App background                                          |
| `--foreground`             | `#1a1a1a` | `#ffffff` | Default text                                            |
| `--card`                   | `#ffffff` | `#111111` | Card / elevated surface background                      |
| `--card-foreground`        | `#1a1a1a` | `#ffffff` | Text on cards                                           |
| `--popover`                | `#ffffff` | `#1a1a1a` | Popover / dropdown background                           |
| `--popover-foreground`     | `#1a1a1a` | `#ffffff` | Text in popovers                                        |
| `--primary`                | `#1a1a1a` | `#ffffff` | Primary action (buttons, links)                         |
| `--primary-foreground`     | `#ffffff` | `#0a0a0a` | Text on primary                                         |
| `--secondary`              | `#f8fafc` | `#1a1a1a` | Secondary action surface                                |
| `--secondary-foreground`   | `#1a1a1a` | `#ffffff` | Text on secondary                                       |
| `--muted`                  | `#f1f5f9` | `#1a1a1a` | Subtle surface (code blocks, inline code)               |
| `--muted-foreground`       | `#64748b` | `#888888` | De-emphasized text, placeholders                        |
| `--accent`                 | `#f4f4f5` | `#27272a` | Hover / selected surface (mention chips, table headers) |
| `--accent-foreground`      | `#18181b` | `#f4f4f5` | Text on accent                                          |
| `--destructive`            | `#ef4444` | `#ef4444` | Errors, dangerous actions                               |
| `--destructive-foreground` | `#ffffff` | `#ffffff` | Text on destructive                                     |
| `--border`                 | `#e2e8f0` | `#2a2a2a` | Default border, dividers, scrollbar thumb               |
| `--input`                  | `#ffffff` | `#1a1a1a` | Form input background                                   |
| `--ring`                   | `#a1a1aa` | `#71717a` | Focus ring (see [Focus rings](#focus-rings))            |

### Semantic status tokens

Used by `<StatusIcon>` and the `.mention-task` chip dot. Adding a new
status? Define a token here so both render paths stay in sync.

| Token                  | Light                   | Dark                    | Status        |
| ---------------------- | ----------------------- | ----------------------- | ------------- |
| `--status-todo`        | `#a1a1aa` (zinc-400)    | `#a1a1aa` (zinc-400)    | `TODO`        |
| `--status-in-progress` | `#3b82f6` (blue-500)    | `#60a5fa` (blue-400)    | `IN_PROGRESS` |
| `--status-in-review`   | `#8b5cf6` (violet-500)  | `#a78bfa` (violet-400)  | `IN_REVIEW`   |
| `--status-done`        | `#10b981` (emerald-500) | `#34d399` (emerald-400) | `DONE`        |

Tailwind utilities: `text-status-{todo,in-progress,in-review,done}` and
the `bg-` / `border-` equivalents.

The three active statuses (IN_PROGRESS / IN_REVIEW / DONE) shift one
Tailwind shade lighter under `.dark` so the colored dot/SVG fill reads
vibrant against the near-black background. TODO holds at zinc-400 in
both modes — the "not started" state is meant to read muted, and
brightening it on dark mode would weaken that de-emphasis.

### Sidebar tokens

Scoped to the app's left sidebar; same shape as the core palette.

`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`,
`--sidebar-primary-foreground`, `--sidebar-accent`,
`--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`.

### Chart palette

Five chart colors driven by Tailwind utilities `bg-chart-1` … `bg-chart-5`.
Used by data viz; not currently themed for dark mode (single palette).

### Landing tokens (`.landing` scope only)

`components/landing/landing.css` defines `--brand`, `--brand-foreground`,
`--light`, `--light-foreground`, `--shadow-strong` inside a `.landing`
selector. The associated Tailwind utilities (`bg-brand`,
`text-brand-foreground`, `shadow-mockup`) are registered there too so
they only render meaningful values inside DOM that has the `.landing`
class (`app/page.tsx <main className="dark landing ...">`).

**Don't reference `bg-brand` outside landing** — values fall back to the
unset state.

## Typography scale

Source of truth: `components/ui/typography.tsx`. Use these components in
preference to raw `<h1>` … `<h6>` so the scale stays consistent.

| Component                                      | Element            | Size · Weight                                    | Notes                                                                                                                                                                           |
| ---------------------------------------------- | ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<TypographyH1>`                               | `<h1>`             | `text-4xl` · `font-extrabold` · `tracking-tight` | Props: `align` (`left` default, `center`, `right`), `balance` (default off). Default is the conservative app-heading idiom; pass `align="center" balance` for marketing heroes. |
| `<TypographyH2>`                               | `<h2>`             | `text-3xl` · `font-semibold` · bottom border     | `first:mt-0` so it sits flush at top of section.                                                                                                                                |
| `<TypographyH3>`                               | `<h3>`             | `text-2xl` · `font-semibold`                     |                                                                                                                                                                                 |
| `<TypographyH4>`                               | `<h4>`             | `text-xl` · `font-semibold`                      |                                                                                                                                                                                 |
| `<TypographyH5>`                               | `<h5>`             | `text-lg` · `font-semibold`                      |                                                                                                                                                                                 |
| `<TypographyH6>`                               | `<h6>`             | `text-base` · `font-semibold`                    |                                                                                                                                                                                 |
| `<TypographyP>`                                | `<p>`              | `leading-7` + top margin after siblings          |                                                                                                                                                                                 |
| `<TypographyLead>`                             | `<p>`              | `text-xl text-muted-foreground`                  | Sub-heading callouts                                                                                                                                                            |
| `<TypographyLarge>`                            | `<div>`            | `text-lg font-semibold`                          |                                                                                                                                                                                 |
| `<TypographySmall>`                            | `<small>`          | `text-sm leading-none font-medium`               |                                                                                                                                                                                 |
| `<TypographyMuted>`                            | `<p>`              | `text-sm text-muted-foreground`                  |                                                                                                                                                                                 |
| `<TypographyBlockquote>`                       | `<blockquote>`     | left-border + italic                             |                                                                                                                                                                                 |
| `<TypographyList>` / `<TypographyOrderedList>` | `<ul>` / `<ol>`    | `list-disc` / `list-decimal` with item spacing   |                                                                                                                                                                                 |
| `<TypographyInlineCode>` / `<TypographyCode>`  | `<code>` / `<pre>` | Mono, tokenized via `--muted` / `--foreground`   |                                                                                                                                                                                 |
| `<TypographyTable*>`                           | `<table>` family   | Tokenized via `--border` / `--muted`             |                                                                                                                                                                                 |

**Fonts** (registered via `@theme inline` → Tailwind utilities `font-sans` /
`font-mono`):

- `--font-inter` → `Inter, sans-serif`
- `--font-source-code-pro` → `Source Code Pro, monospace`

## Spacing & layout

Custom container widths registered as `@theme` spacing utilities:

| Token                    | Value    | Use                   |
| ------------------------ | -------- | --------------------- |
| `--spacing-container`    | `1280px` | `max-w-container`     |
| `--spacing-container-lg` | `1536px` | `max-w-container-lg`  |
| `--breakpoint-xs`        | `30rem`  | Tailwind `xs:` prefix |

All other spacing comes from Tailwind's default 4-px scale (`p-2`, `gap-4`,
`mt-8`, …) — no project-specific spacing tokens beyond the above.

## Radius

| Token / utility              | Value                               |
| ---------------------------- | ----------------------------------- |
| `--radius`                   | `0.75rem`                           |
| `rounded-sm` (`--radius-sm`) | `calc(--radius - 4px)` = `0.5rem`   |
| `rounded-md` (`--radius-md`) | `calc(--radius - 2px)` = `0.625rem` |
| `rounded-lg` (`--radius-lg`) | `var(--radius)` = `0.75rem`         |
| `rounded-xl` (`--radius-xl`) | `calc(--radius + 4px)` = `1rem`     |

Use `rounded-md` for inputs / chips, `rounded-lg` for cards.

## Focus rings

- Token: `--ring` (= `#a1a1aa` light, `#71717a` dark).
- Base style is set globally: `outline-color: color-mix(in srgb, var(--color-ring) 50%, transparent)`.
- For component focus, prefer Tailwind `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (shadcn pattern) — never roll a hard-coded ring color.

## Motion

### Named animations (`@theme` utilities)

Registered in `app/globals.css @theme inline`:

- `--animate-appear` → `animate-appear` — fade + slight rise (used on landing components).
- `--animate-appear-zoom` → `animate-appear-zoom` — fade + zoom in.

### Keyframes

`@keyframes` defined in `app/globals.css`: `appear`, `appear-zoom`,
`fade-in-up`, `wave-left`, `wave-right`, `float-slow`, `float-medium`,
`blob`, `fade-out`. Bound to corresponding `.animate-*` classes for
landing-page motion. Don't redefine these — extend by adding a new
keyframe + class.

### Duration conventions

Observed in the codebase; treat as the standard set:

- `duration-150` / `duration-100` — micro-interactions (button hover state, focus ring).
- `duration-200` — small UI transitions (popover open, dropdown).
- `duration-300` — standard transitions (sheet slide, accordion).
- `duration-500` — slower, deliberate transitions (page-level fades).

Use Tailwind utilities; don't introduce raw `transition-duration` values.

## Z-index layering

Observed convention (top of stack last):

| Layer                   | Tailwind  | When                             |
| ----------------------- | --------- | -------------------------------- |
| Base                    | _none_    | Default content                  |
| Elevated                | `z-10`    | Sticky headers, raised cards     |
| Dropdown                | `z-20`    | Dropdown content, hovercards     |
| Nav overlay             | `z-40`    | Persistent navigation overlays   |
| Modal / Sheet / Popover | `z-50`    | Dialogs, sheets, command palette |
| Toast                   | `z-[100]` | Top-of-stack notifications       |

Avoid arbitrary `z-[1]` etc. — pick a tier above.

## Shadows

The full Tailwind scale (`shadow-sm` → `shadow-2xl`) is in use; no project
shadow tokens beyond `--shadow-mockup` (landing-only, for the product
mockup hero). Use `shadow-sm` for borders-without-borders subtlety,
`shadow-md` for hovered cards, `shadow-lg` for modals & menus.

## Utility cheat sheet

Project-specific utilities registered in `app/globals.css`:

### Glass surfaces (landing)

`glass-1` · `glass-2` · `glass-3` · `glass-4` · `glass-5` — stacked
backdrop-blur glass variants. Used on landing sections; **don't pull
into the app** (the look doesn't fit the app's flat surface idiom).

### Fade masks

`fade-x` · `fade-y` · `fade-top` · `fade-bottom` · `fade-left` ·
`fade-right` (+ each with `-lg` variant). CSS `mask-image` gradients
that fade content toward the edges. Use on scroll edges and overflowing
carousels.

### Line decorations

`line-x` · `line-y` · `line-t` · `line-b` · `line-dashed`. Tokenized
border helpers driven by a `--line-width` custom property (defaults
unset; set on the element or a parent).

### Scroll

- Global scrollbar styled to 6px, `var(--border)` thumb, hover →
  `var(--muted-foreground)`.
- `board-col-scroll` — column-internal scrollbar that hides until hover.

## Conventions

### Always use tokens for color

```tsx
// ❌ Don't hard-code hex / rgb in components
<div className="bg-[#f1f5f9] text-[#64748b]">…</div>

// ❌ Don't add `var(--token, #fallback)` — tokens are always defined.
<div style={{ background: 'var(--accent, #4f46e5)' }}>…</div>

// ✅ Use the Tailwind utility backed by a token
<div className="bg-muted text-muted-foreground">…</div>
```

### Don't add `.dark` reversal rules

The token system already inverts every core token under `.dark`. If you
find yourself writing `.dark .my-thing { color: ... }`, you're probably
referencing a raw color instead of a token.

### Status colors come from `--status-*` only

`<StatusIcon>` resolves the status → `text-status-*` className; the
`.mention-task` chip dot does the same via CSS. Anywhere else that
shows a status indicator should do the same — never copy the hex.

### SVG colors go through `currentColor`

So a wrapping className (or parent color context) drives them and dark
mode flows through automatically. See `StatusIcon.tsx` for the pattern.

### Typography component, not raw `<h1>`

Always use `<TypographyH1>` … `<TypographyMuted>`. Composing your own
class string for headings makes the scale drift.

## Adding a new token

1. Add to `:root` and `.dark` in `app/globals.css`.
2. If you want Tailwind utilities, register it inside `@theme inline`
   with the `--color-` / `--font-` / `--spacing-` / `--shadow-` / `--animate-`
   prefix Tailwind v4 expects.
3. Add a row to the relevant table in this doc.
4. Verify with: `npx @tailwindcss/cli -i app/globals.css -o /tmp/out.css`
   and grep the output for the expected utility class.

## Known follow-ups (LUM-94 P2)

- Tune `--status-*` for dark-mode legibility (currently identical to light).
- Lint rule: CI greps `components/` and `app/` for hex/rgb literals
  outside `globals.css` and fails the build.
- Split `components/ui/sidebar.tsx` (23 KB single file) into SRP units.
