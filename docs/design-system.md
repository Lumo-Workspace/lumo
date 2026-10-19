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
| `--ring`                   | `#3b82f6` | `#3b82f6` | Focus ring (see [Focus rings](#focus-rings))            |

### Semantic status tokens

Used by `<StatusIcon>` and the `.mention-task` chip dot. Adding a new
status? Define a token here so both render paths stay in sync.

| Token                  | Both modes | Status        |
| ---------------------- | ---------- | ------------- |
| `--status-todo`        | `#d1d5dc`  | `TODO`        |
| `--status-in-progress` | `#2b7fff`  | `IN_PROGRESS` |
| `--status-in-review`   | `#bf2bff`  | `IN_REVIEW`   |
| `--status-done`        | `#41b40f`  | `DONE`        |

Tailwind utilities: `text-status-{todo,in-progress,in-review,done}` and
the `bg-` / `border-` equivalents.
In-review **text** (e.g. the in-review chip) uses
`text-status-in-review-text` — see [Semantic feedback tokens](#semantic-feedback-tokens).

These are the Lumo brand status colors — one canonical hex per status,
identical in `:root` and `.dark`. They were tuned by hand for adequate
contrast against both backgrounds, so they don't follow a "shift one
shade for dark mode" rule. If a status palette ever needs to diverge by
theme, update both blocks in lockstep and document why.

### Semantic feedback tokens

`info` / `warning` / `success` / `danger` (LUM-258). Each family has an
accent (`--warning`: icon / border / dot), `-foreground` (near-black text on a
solid accent fill), `-subtle` / `-border` (translucent color-mix fills), and a
`-text` step for coloured text on the page background or on its own `-subtle`
fill (warning / danger LUM-934; success / info / in-review LUM-969).

| Token                     | Light                                        | Dark                  | Use for                                                     |
| ------------------------- | -------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| `--warning-text`          | amber-700 (`#bb4d00`) 5.05 / 4.68            | `var(--warning)`      | Caveat / approximate notes printed as text; warning icons   |
| `--danger-text`           | red-700 (`#c10007`) 6.42 / 5.64              | `var(--danger)`       | Error counts / error text; also all destructive-action text |
| `--success-text`          | green-700 (`#008236`) 4.94 / 4.54            | `var(--success)`      | Success / merged / on-track text and chips; success icons   |
| `--info-text`             | blue-600 (`#155dfc`) 5.26 / 4.69             | `var(--info)`         | Info links and chips                                        |
| `--status-in-review-text` | deeper in-review hue (`#a125d7`) 5.58 / 4.84 | `#c452fd` 5.63 / 5.27 | In-review chips (`bg-status-in-review-subtle`)              |

Ratios are _on the page background / on the family's own `-subtle` fill_
(alpha composited). The light accents (success ~2.3:1, warning ~2.1:1, info
~3.7:1, danger ~3.8:1, in-review ~4.2:1 on white) are tuned as strokes and miss
AA as text, so text uses the darker `-text` step; dark mode reuses the bright
accent (all ≥4.7:1 on `#0a0a0a` and ≥4.5:1 on their own subtle fill), except
in-review: the shared brand magenta is only ~4.4:1 on its own subtle fill, so
dark `--status-in-review-text` is a lighter step of the same hue (LUM-968).
Light `--danger-text` was red-600 (`#e7000b`, 4.18 on `-subtle`) until LUM-968.
Every `-text` token clears 4.5:1 on both surfaces in both modes.

Utilities: `text-{warning,danger,success,info,status-in-review}-text`.

- **Text** (including a chip whose icon shares `currentColor` with its label)
  always uses the `-text` utility.
- **Destructive text** uses `text-danger-text`: `--destructive` (shadcn) and
  `--danger` are the same `#ef4444` in light mode and mean the same thing, so
  there is one readable red rather than a second `--destructive-text`.
  `bg-destructive` / `border-destructive` / `text-destructive-foreground`
  (buttons, badges) are unchanged.
- **Icons** may keep the bare `text-info` / `text-danger` / `text-destructive`
  / `text-status-in-review` accent (all ≥3:1, WCAG non-text). The light
  `success` and `warning` accents miss even 3:1, so their icons use
  `text-success-text` / `text-warning-text` too.
- **Graphics** (dots, bars, strips, strokes, fills) follow the icon rule —
  WCAG 1.4.11, 3:1 on the surface they actually sit on, both modes (LUM-968).
  Success / warning graphics use `bg-` / `stroke-` / `fill-success-text` and
  `-warning-text`; danger / info may keep the bare accent (≥3:1 on card, muted
  and their own `-subtle`). Status maps use semantic tokens, never Tailwind
  greens / ambers (`HEALTH_DOT`: success-text / warning-text / danger).
- **Progress with a label on top**: a darker full-height fill can't give both
  3:1 against the track and 4.5:1 for the label sitting on it, so the label
  stays on the `-subtle` bar and progress is a bottom strip
  (`SprintTimeline`); a secondary series (elapsed time) is a tick that
  extends past the track (`CurrentSprintCard`).
- **Dots on a selected `bg-primary` pill** get `ring-1 ring-primary-foreground`
  — no feedback hue clears 3:1 on both the near-black (light) and white
  (dark) primary.

**No raw Tailwind palette classes in app UI (LUM-1245).** Map hues to the
families above instead of `text-red-500` / `bg-amber-50` / `border-indigo-300`
plus a `dark:` twin: red → `danger`, amber/yellow/orange → `warning`,
green/emerald → `success`, blue/sky and AI/agent violet/indigo → `info`.
Fills use `bg-*-subtle`, hover fills `hover:bg-*/15`, outlines `border-*-border`,
text and icons `text-*-text`; selection/drop indicators use `ring` /
`border-ring`; destructive confirm buttons use `variant='destructive'`. The
tokens already re-resolve in `.dark`, so no `dark:` colour override is needed.
A fixed-dark surface (signup) puts `dark` on its root and uses the same tokens.
Survivors with a recorded reason: `RevisionDiffView` (diff ins/del colours — no
diff token yet), `TurnCard` memory left border (owned by LUM-1249), and the
vendored `components/ui/shadcn-io/aurora-background`.

`__tests__/styles/feedback-text-usage.test.ts` pins every audited bare-accent
icon site per family (success / warning: none) so new text uses can't creep
back; `__tests__/styles/feedback-contrast.test.ts` computes every ratio above
(LUM-967 / LUM-969).

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

单一来源 `--radius: 0.75rem`;`@theme inline` 派生干净的 4px 步进档位。

| Token / utility              | calc                   | 值        |
| ---------------------------- | ---------------------- | --------- |
| `rounded-sm` (`--radius-sm`) | `calc(--radius − 8px)` | `0.25rem` |
| `rounded-md` (`--radius-md`) | `calc(--radius − 4px)` | `0.5rem`  |
| `rounded-lg` (`--radius-lg`) | `var(--radius)`        | `0.75rem` |
| `rounded-xl` (`--radius-xl`) | `calc(--radius + 4px)` | `1rem`    |

**档位映射规则(哪类元素用哪档):**

| 元素类                                                  | 档位           |
| ------------------------------------------------------- | -------------- |
| inline 小件:chip / tag / 内联 token                     | `rounded-sm`   |
| 控件:button / input / select / 菜单项 / 关闭按钮        | `rounded-md`   |
| 表面:card / dialog / popover / dropdown / sheet / panel | `rounded-lg`   |
| pill / badge / 头像 / 圆形图标按钮                      | `rounded-full` |
| 大容器 / 特例                                           | `rounded-xl`   |

裸 `rounded`(= `0.25rem`,与 `rounded-sm` 同值)**禁用** —— 由 `lint:tokens` 拦截。
方向性圆角(`rounded-t/l/r/b/tl…`)与 arbitrary `rounded-[..]` 按需使用,不受档位约束。

## Focus rings

- Token: `--ring: var(--focus-ring)`, where `--focus-ring` = `oklch(0.6231 0.188 259.813)` (`#3b82f6`, blue). Defined once in `:root` with no `.dark` override, so it is identical in light and dark (LUM-262). `--sidebar-ring` derives from `--focus-ring` too.
- Base style is set globally in `@layer base`: `* { @apply border-border outline-ring/50; }` — this only sets the outline **colour** (`--ring` at 50%); it doesn't draw an outline by itself.
- Primitives (`Button`, `Badge`, `Textarea`) use `focus-visible:ring-[3px] focus-visible:ring-ring/50` plus `focus-visible:border-ring`. `Input` and `Select` only switch the border to `border-ring` (no ring shadow). Never roll a hard-coded ring colour.
- Borderless document-style fields (title / description inputs in create modals, inline table edits, the memory and milestone dialogs) deliberately get no ring (`focus:ring-0 outline-none`) — focus reads from the caret, not a box.

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

### Overlay (scrim)

Every modal surface — Dialog, AlertDialog, Sheet and the workspace `Modal` —
uses the same scrim: `bg-black/50`, **no** `backdrop-blur`, in both themes.
Don't hand-roll a different tint or blur on a new overlay.

## Shadows / Elevation

阴影走 token 化的 elevation 分级 —— `:root` 与 `.dark` 各定义一组(暗色更强,
因深色背景上阴影几乎不可见),`@theme inline` 注册成工具类。**禁止**直接用
Tailwind 内置 `shadow` / `shadow-xs…2xl` 或硬编码 `shadow-[..]`(由 `lint:tokens`
拦截);`shadow-none` 允许;`drop-shadow-*`(filter)不受此规则约束。

| 工具类               | 用途     | 组件                                                           | 亮色值                                                                  | 暗色值                                                                  |
| -------------------- | -------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `shadow-elevation-1` | 静态抬起 | card / panel / 抬起控件(button/input) / sticky header          | `0 1px 2px 0 rgb(0 0 0 / 0.05)`(单层发丝阴影,同 shadcn `shadow-xs`)     | `0 1px 2px 0 rgb(0 0 0 / 0.3)`                                          |
| `shadow-elevation-2` | 锚定浮层 | popover / dropdown / select-content / hovercard / context-menu | `0 2px 4px -1px rgb(0 0 0 / 0.08), 0 4px 8px -1px rgb(0 0 0 / 0.12)`    | `0 2px 4px -1px rgb(0 0 0 / 0.45), 0 4px 8px -1px rgb(0 0 0 / 0.55)`    |
| `shadow-elevation-3` | 顶级浮层 | dialog / sheet / command 面板 / toast                          | `0 8px 16px -4px rgb(0 0 0 / 0.12), 0 12px 24px -6px rgb(0 0 0 / 0.18)` | `0 8px 16px -4px rgb(0 0 0 / 0.55), 0 12px 24px -6px rgb(0 0 0 / 0.65)` |

elevation-1 刻意只有一层很淡的阴影,让静态控件读起来是平的(LUM-1241);层次主要靠
1px 边框。因此控件本身必须不依赖阴影也能看清 —— 例如 Switch 未选中轨道用 `bg-border`
而不是 `bg-input`(亮色 `--input` 是白色输入框底色)。

底层值在 `app/globals.css` 的 `--elevation-1/2/3`(`:root`/`.dark`)。调整观感改
那里即可,组件不碰。landing 专用的 `--shadow-mockup` 仍在 `landing.css`。

1px 描边(border 替代)用 `ring-1 ring-<token>`,**不要**用 `shadow-[0_0_0_1px_…]`
(且 `hsl(var(--token))` 在 oklch token 下是非法 CSS)。

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

## Token-discipline lint

`scripts/lint-tokens.ts` enforces the no-hex / no-neutral-palette rules
above. It runs:

- on every staged commit via `lint-staged` (the husky pre-commit hook)
- when you run `npm run lint`
- on demand via `npm run lint:tokens`

The repo carries ~2 000 pre-existing violations from before the lint
existed, so a strict gate would block every PR. Instead the script
runs in **baseline mode**:

- `scripts/lint-tokens.baseline.json` snapshots the per-file violation
  count at HEAD.
- A PR fails only if a file's count **grows** vs. the baseline, or a
  new file appears with any violations.
- Cleanup PRs that shrink the count never fail; after the cleanup,
  `npm run lint:tokens:update` re-snapshots the lower count, locking
  it in so the file can't regress.

| Command                      | What it does                                                              |
| ---------------------------- | ------------------------------------------------------------------------- |
| `npm run lint:tokens`        | Default. Scans, checks against the baseline. Non-zero exit on regression. |
| `npm run lint:tokens:audit`  | `--full` mode. Prints every current violation (baseline ignored).         |
| `npm run lint:tokens:update` | Rewrites the baseline to the current state. Commit the diff.              |

When the lint flags a violation, the first move is **hoist into a
token** (see [Adding a new token](#adding-a-new-token)). Adding a file
to `ALLOWLIST` in the script is the escape hatch and weakens the rule
permanently — only use it for files where raw color values are
intentionally the file's payload (token-definition CSS, SVG icon
sources). Every new allowlist entry should come with a justification
comment.

## Known follow-ups (LUM-94 P2)

- Split `components/ui/sidebar.tsx` (23 KB single file) into SRP units.
