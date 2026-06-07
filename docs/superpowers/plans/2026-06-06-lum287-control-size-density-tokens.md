# Control Size / Density Tier Tokens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `button` / `input` / `badge` a single semantic source for control height and inline padding via density tier tokens, so control sizing is adjustable in one place.

**Architecture:** Add a `--spacing-control-*` (height) and `--spacing-control-inset-*` (inline padding) token group to the Tailwind v4 `@theme inline` block in `app/globals.css`. These emit `h-control-{sm,md,lg}` / `w-control-md` / `px-control-inset-{sm,md,lg}` utilities. Rewire the three atomic components onto those utilities — 1:1 zero-visual-change extraction of the existing `h-8/9/10` + `px-3/4/8` values, except Badge (`px-2.5 → px-control-inset-sm`, the one accepted +2px/side change). Mirrors the LUM-260 typography-scale precedent (tokens + `docs/design-system/*` doc + `__tests__/styles/*` guard).

**Tech Stack:** Tailwind CSS v4 `@theme` tokens, Next.js, TypeScript, Jest + @testing-library/react (jsdom).

**Worktree:** `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens`. Run ALL `jest` / `tsc` from inside this worktree (`cd` first) — running jest from the main checkout hits a `cli/package.json` haste collision and silently runs the wrong tests.

**globals.css guard fragility:** The `__tests__/styles/` guards parse `app/globals.css` as raw text. Any comment you add to globals.css must NOT contain `{` `}` or the literal string `@theme inline`, or it silently breaks the color/radius guards. Run the FULL `__tests__/styles/` suite after editing globals.css.

---

## File Structure

- `app/globals.css` (modify, `@theme inline` block ~line 772, after `--spacing-container-lg`) — the six new tokens.
- `__tests__/styles/control-size-tokens.test.ts` (create) — raw-text guard for the tokens.
- `components/ui/button.tsx` (modify, `size` cva variants ~line 26-31) — wire onto utilities.
- `components/ui/input.tsx` (modify, className ~line 12) — wire onto utilities.
- `components/ui/badge.tsx` (modify, cva base ~line 9) — wire onto utilities.
- `__tests__/components/ui/Button.control-size.test.tsx` (create) — render guard.
- `__tests__/components/ui/Input.control-size.test.tsx` (create) — render guard.
- `__tests__/components/ui/Badge.control-size.test.tsx` (create) — render guard.
- `docs/design-system/control-size-scale.md` (create) — companion doc.

---

## Task 1: Tokens + globals.css guard

**Files:**
- Create: `__tests__/styles/control-size-tokens.test.ts`
- Modify: `app/globals.css` (`@theme inline` block, after `--spacing-container-lg`)

- [ ] **Step 1: Write the failing guard test**

Create `__tests__/styles/control-size-tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-287: control size/density tiers carried as Tailwind v4 --spacing-* tokens
// in app/globals.css. Each tier MUST declare its height and inline-padding token
// so a tier cannot be silently dropped or renamed out from under the
// h-control-* / px-control-inset-* call sites in the atomic components.
const TIERS = ['sm', 'md', 'lg'] as const

describe('app/globals.css control size tokens', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

  it.each(TIERS)('declares --spacing-control-%s height with a rem value', (tier) => {
    expect(css).toMatch(new RegExp(`--spacing-control-${tier}:\\s*[\\d.]+rem;`))
  })

  it.each(TIERS)(
    'declares --spacing-control-inset-%s padding with a rem value',
    (tier) => {
      expect(css).toMatch(
        new RegExp(`--spacing-control-inset-${tier}:\\s*[\\d.]+rem;`)
      )
    }
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/styles/control-size-tokens.test.ts`
Expected: FAIL — 6 assertions, "received value did not match" (tokens not yet in globals.css).

- [ ] **Step 3: Add the tokens to globals.css**

In `app/globals.css`, inside the `@theme inline { … }` block, immediately after the line `--spacing-container-lg: 1536px;`, insert:

```css

  /* Control size / density tiers (LUM-287). Single semantic source for control
     height + inline padding; the two are SEPARATE axes because Input is
     height-md but padding-sm. Values are 1:1 with the prior raw utilities
     (h-8/9/10, px-3/4/8) for zero visual change. Emits h-control-* / w-control-*
     / px-control-inset-* via the Tailwind v4 --spacing- namespace.
     Reference: docs/design-system/control-size-scale.md */
  --spacing-control-sm: 2rem;
  --spacing-control-md: 2.25rem;
  --spacing-control-lg: 2.5rem;
  --spacing-control-inset-sm: 0.75rem;
  --spacing-control-inset-md: 1rem;
  --spacing-control-inset-lg: 2rem;
```

(The comment contains no `{` `}` and not the literal `@theme inline`, so the raw-text style guards stay intact.)

- [ ] **Step 4: Run the guard test + the full styles suite**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/styles/`
Expected: PASS — the new `control-size-tokens` test plus all pre-existing `globals-css-*` / `status-color` / `typography-scale` guards still green.

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens
git add app/globals.css __tests__/styles/control-size-tokens.test.ts
git commit -m "feat: add control size/density tier tokens to globals.css [LUM-287]"
```

---

## Task 2: Wire Button onto the tiers

**Files:**
- Create: `__tests__/components/ui/Button.control-size.test.tsx`
- Modify: `components/ui/button.tsx` (the `size` variants object)

- [ ] **Step 1: Write the failing render test**

Create `__tests__/components/ui/Button.control-size.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { Button } from '@/components/ui/button'

describe('Button control-size tokens', () => {
  it('default size draws height + inline padding from the md tier', () => {
    const { getByRole } = render(<Button>Save</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-md')
    expect(cls).toContain('px-control-inset-md')
  })

  it('sm size uses the sm tier', () => {
    const { getByRole } = render(<Button size='sm'>Save</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-sm')
    expect(cls).toContain('px-control-inset-sm')
  })

  it('lg size uses the lg tier', () => {
    const { getByRole } = render(<Button size='lg'>Save</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-lg')
    expect(cls).toContain('px-control-inset-lg')
  })

  it('icon size is an md-height square', () => {
    const { getByRole } = render(
      <Button size='icon' aria-label='close'>
        x
      </Button>
    )
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-md')
    expect(cls).toContain('w-control-md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/components/ui/Button.control-size.test.tsx`
Expected: FAIL — class strings still `h-9` / `px-4` etc.

- [ ] **Step 3: Rewrite the size variants**

In `components/ui/button.tsx`, replace the `size` object inside `buttonVariants`:

```ts
      size: {
        default: 'h-control-md px-control-inset-md py-2',
        sm: 'h-control-sm rounded-md px-control-inset-sm text-xs',
        lg: 'h-control-lg rounded-md px-control-inset-lg',
        icon: 'h-control-md w-control-md',
      },
```

(Only `h-*` / `px-*` / `w-*` change. `rounded-md`, `text-xs`, `py-2` are preserved exactly — `py-2` is vestigial under a fixed height but kept for byte-level visual parity.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/components/ui/Button.control-size.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens
git add components/ui/button.tsx __tests__/components/ui/Button.control-size.test.tsx
git commit -m "refactor: draw Button sizing from control-size tokens [LUM-287]"
```

---

## Task 3: Wire Input onto the tiers

**Files:**
- Create: `__tests__/components/ui/Input.control-size.test.tsx`
- Modify: `components/ui/input.tsx` (the `cn(...)` className)

- [ ] **Step 1: Write the failing render test**

Create `__tests__/components/ui/Input.control-size.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { Input } from '@/components/ui/input'

describe('Input control-size tokens', () => {
  it('draws md height and the sm inline-padding tier', () => {
    const { container } = render(<Input placeholder='Search' />)
    const cls = (container.querySelector('input') as HTMLElement).className
    expect(cls).toContain('h-control-md')
    expect(cls).toContain('px-control-inset-sm')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/components/ui/Input.control-size.test.tsx`
Expected: FAIL — className still has `h-9` / `px-3`.

- [ ] **Step 3: Swap the two utilities**

In `components/ui/input.tsx`, in the first argument of `cn(...)`, change `h-9` → `h-control-md` and the control's `px-3` → `px-control-inset-sm`. The string becomes:

```ts
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-control-md w-full min-w-0 rounded-md border bg-transparent px-control-inset-sm py-1 text-base shadow-elevation-1 transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
```

(Leave `file:h-7`, `py-1`, `text-base`, `md:text-sm` untouched — `file:h-7` is the file-picker button, not a control tier.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/components/ui/Input.control-size.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens
git add components/ui/input.tsx __tests__/components/ui/Input.control-size.test.tsx
git commit -m "refactor: draw Input sizing from control-size tokens [LUM-287]"
```

---

## Task 4: Wire Badge onto the sm inset tier

**Files:**
- Create: `__tests__/components/ui/Badge.control-size.test.tsx`
- Modify: `components/ui/badge.tsx` (the cva base string)

- [ ] **Step 1: Write the failing render test**

Create `__tests__/components/ui/Badge.control-size.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { Badge } from '@/components/ui/badge'

describe('Badge control-size tokens', () => {
  it('uses the sm inline-padding tier', () => {
    const { container } = render(<Badge>New</Badge>)
    const cls = (container.firstChild as HTMLElement).className
    expect(cls).toContain('px-control-inset-sm')
  })

  it('keeps its py-0.5 vertical inset', () => {
    const { container } = render(<Badge>New</Badge>)
    const cls = (container.firstChild as HTMLElement).className
    expect(cls).toContain('py-0.5')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/components/ui/Badge.control-size.test.tsx`
Expected: FAIL — base string still has `px-2.5`.

- [ ] **Step 3: Swap px-2.5 → px-control-inset-sm**

In `components/ui/badge.tsx`, in the `cva(...)` base string (first argument), change `px-2.5` to `px-control-inset-sm`. The string becomes:

```ts
  'inline-flex items-center rounded-full border px-control-inset-sm py-0.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
```

(This is the one accepted visual change: 10px → 12px horizontal padding. `py-0.5` is retained.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/components/ui/Badge.control-size.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens
git add components/ui/badge.tsx __tests__/components/ui/Badge.control-size.test.tsx
git commit -m "refactor: draw Badge inline padding from control-size sm tier [LUM-287]"
```

---

## Task 5: Companion doc + full verification

**Files:**
- Create: `docs/design-system/control-size-scale.md`

- [ ] **Step 1: Write the doc**

Create `docs/design-system/control-size-scale.md`:

```markdown
# Control Size / Density Scale

Control height and inline padding are carried as Tailwind v4 `--spacing-*`
tokens in `app/globals.css` (LUM-287). Height and inline padding are **separate
axes** — a control can be md-height with sm-padding (Input is). Pick a height
tier and an inset tier independently.

## Height tiers

| Utility          | value   | px   | Replaces |
| ---------------- | ------- | ---- | -------- |
| `h-control-sm`   | 2rem    | 32px | `h-8`    |
| `h-control-md`   | 2.25rem | 36px | `h-9`    |
| `h-control-lg`   | 2.5rem  | 40px | `h-10`   |

`w-control-md` (2.25rem) backs the square icon button.

## Inline-padding tiers

| Utility               | value   | px   | Replaces |
| --------------------- | ------- | ---- | -------- |
| `px-control-inset-sm` | 0.75rem | 12px | `px-3`   |
| `px-control-inset-md` | 1rem    | 16px | `px-4`   |
| `px-control-inset-lg` | 2rem    | 32px | `px-8`   |

## Current consumers

| Component        | Height          | Inline padding         |
| ---------------- | --------------- | ---------------------- |
| Button `default` | `h-control-md`  | `px-control-inset-md`  |
| Button `sm`      | `h-control-sm`  | `px-control-inset-sm`  |
| Button `lg`      | `h-control-lg`  | `px-control-inset-lg`  |
| Button `icon`    | `h-control-md`  | `w-control-md` (square)|
| Input            | `h-control-md`  | `px-control-inset-sm`  |
| Badge            | content-sized   | `px-control-inset-sm`  |

## Not part of this scale

- `gap` (icon↔label) — uniform `gap-2`, not a density tier.
- Text size — owned by the typography scale (`text-caption` / `text-body` …).
- Vertical padding (`py-*`) — per-component constant; height tiers fix box height.

## Adjusting density

Edit the token value in `app/globals.css`; every consumer follows. The
`__tests__/styles/control-size-tokens.test.ts` guard ensures no tier is dropped
or renamed.

## Follow-up

Raw `h-8/9/10` and `px-3/4/8` still appear at ~40 call sites outside these
atoms. Converging them onto `h-control-*` / `px-control-inset-*` is future work.
```

- [ ] **Step 2: Run the full relevant test surface**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx jest __tests__/styles/ __tests__/components/ui/`
Expected: PASS — all style guards + the 3 component render guards.

- [ ] **Step 3: TypeScript check**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npx tsc --noEmit`
Expected: clean (no errors). If you see "X not exported" Prisma-client errors, run `npx prisma generate` once and re-run — that is a stale generated client, not this change.

- [ ] **Step 4: Token lint**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens && npm run lint:tokens`
Expected: PASS with no baseline change — the new utilities are spacing, not color, so `lint:tokens` (a color guard) should be unaffected. Do NOT run `--update`.

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-287-spacing-sizing-density-tokens
git add docs/design-system/control-size-scale.md
git commit -m "docs: control size/density scale reference [LUM-287]"
```

---

## Self-Review notes (verified before handoff)

- **Spec coverage:** tokens (Task 1) · button/input/badge wiring (Tasks 2-4) · doc + guard + render tests (Tasks 1 & 5) — all spec sections mapped.
- **Type/name consistency:** token names `--spacing-control-{sm,md,lg}` and `--spacing-control-inset-{sm,md,lg}`, utilities `h-control-*` / `w-control-md` / `px-control-inset-*` — identical across globals.css, components, tests, and doc.
- **Zero visual change** holds for button/input (1:1 value map); Badge `px-2.5 → px-control-inset-sm` is the single, spec-approved exception.
```
