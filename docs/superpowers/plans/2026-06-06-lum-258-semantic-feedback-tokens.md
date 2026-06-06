# Semantic Feedback Color Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--info/--warning/--success/--danger` semantic feedback tokens (each with `-foreground`/`-subtle`/`-border`) as a single source of truth, and re-drive the callout's five variants from them, deleting the duplicated `.dark` callout palette.

**Architecture:** Solid accent + near-black `-foreground` are oklch tokens (accent overridden brighter in `.dark`). `-subtle`/`-border` are `color-mix(var(--accent) N%, transparent)` defined once in `:root` — translucent, so they composite over `--background` and adapt to dark mode automatically. `@theme inline` exposes all four variants as utilities. Callout variant rules consume the tokens; `error`→`danger`, `note` stays neutral.

**Tech Stack:** Tailwind v4 `@theme inline`, CSS custom properties (oklch + color-mix), Jest (string assertions over `app/globals.css`).

**Spec:** `docs/superpowers/specs/2026-06-06-lum-258-semantic-feedback-tokens-design.md`

**Branch:** `lumo/LUM-258-semantic-feedback-color-tokens` (already created off origin/main @ 8ef8bb53, which contains LUM-257).

---

## File Structure

- **Modify** `app/globals.css`:
  - `:root` (after the status-color block, ~line 538): add 4 accent + 4 `-foreground` + 4 `-subtle` + 4 `-border` tokens.
  - `.dark` (after the status-color block, ~line 578): add 4 accent overrides.
  - `@theme inline` (after `--color-status-done`, ~line 621): register 16 `--color-*` mappings.
  - Callout variant rules (lines 195-241): rewrite the 5 light rules to token-driven; delete the 4 `.dark .callout[...]` rules.
- **Modify** `__tests__/styles/globals-css-color-tokens.test.ts`: extend `COLOR_TOKENS`; add a `color-mix` subtle/border test, a `.dark` accent-override test, and a callout-token-driven test.

No new npm packages. `chroma-js` (already a dep) was used only at design time for verification — not imported by app or test code.

---

### Task 1: Feedback tokens in `:root`, `.dark`, and `@theme`

**Files:**

- Modify: `app/globals.css` (`:root`, `.dark`, `@theme inline`)
- Test: `__tests__/styles/globals-css-color-tokens.test.ts`

- [ ] **Step 1: Extend the test's `COLOR_TOKENS` list (failing test)**

In `__tests__/styles/globals-css-color-tokens.test.ts`, append the 8 solid tokens to the `COLOR_TOKENS` array (after `'status-done',` on line 59). Only the solid oklch tokens go here — NOT `-subtle`/`-border` (those are `color-mix`, asserted separately in Step 2):

```ts
  'status-done',
  // LUM-258 semantic feedback colors (solid oklch accents + near-black foregrounds).
  'info',
  'info-foreground',
  'warning',
  'warning-foreground',
  'success',
  'success-foreground',
  'danger',
  'danger-foreground',
] as const
```

- [ ] **Step 2: Add the `color-mix` subtle/border test (failing test)**

Append this block to the end of `__tests__/styles/globals-css-color-tokens.test.ts`:

```ts
// LUM-258: -subtle / -border are translucent color-mix of the accent, defined
// ONCE in :root (no .dark override). Translucent so they composite over
// --background and adapt to dark mode automatically — that's what lets the
// duplicated .dark callout palette be deleted.
describe.each(['info', 'warning', 'success', 'danger'])(
  '--%s subtle/border',
  c => {
    it.each(['subtle', 'border'])(
      '--%s-%s is a single color-mix over var(--%s)',
      (_, variant) => {
        const re = new RegExp(`--${c}-${variant}:\\s*([^;]+);`, 'g')
        const defs = [...css.matchAll(re)].map(m => (m[1] ?? '').trim())
        expect(defs).toHaveLength(1) // defined once, no per-mode duplicate
        expect(defs[0]).toMatch(
          new RegExp(
            `^color-mix\\(in srgb, var\\(--${c}\\) \\d+%, transparent\\)$`
          )
        )
      }
    )
  }
)

// LUM-258: the .dark block must brighten the four accents (regression guard so
// the dark-mode accent override isn't lost in a future edit).
describe('.dark feedback accent overrides', () => {
  const darkBlock = css.slice(css.indexOf('.dark {'), css.indexOf('@theme'))
  it.each(['info', 'warning', 'success', 'danger'])(
    '.dark redefines --%s',
    c => {
      expect(darkBlock).toMatch(new RegExp(`--${c}:\\s*oklch\\(`))
    }
  )
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest __tests__/styles/globals-css-color-tokens.test.ts`
Expected: FAIL — the new `--info` etc. tokens don't exist yet (oklch assertions and color-mix assertions fail).

- [ ] **Step 4: Add the `:root` feedback tokens**

In `app/globals.css`, insert this block inside `:root`, immediately after the `--status-done:` line (currently line 538) and before the blank line + `--font-inter`:

```css
/* Semantic feedback colors (LUM-258). Accent = left border / icon / emphasis;
     -foreground = near-black text on a solid accent fill (AA-verified, never
     var(--foreground) which would flip white and fail on a light accent);
     -subtle / -border = translucent color-mix of the accent, defined once here
     and auto-adapting to .dark because they composite over --background.
     oklch values are exact equivalents of the Tailwind palette hex (in comments). */
--info: oklch(0.6231 0.188 259.813); /* #3b82f6 */
--info-foreground: oklch(0.2178 0 0); /* #1a1a1a */
--info-subtle: color-mix(in srgb, var(--info) 10%, transparent);
--info-border: color-mix(in srgb, var(--info) 28%, transparent);
--warning: oklch(0.7686 0.1647 70.073); /* #f59e0b */
--warning-foreground: oklch(0.2178 0 0); /* #1a1a1a */
--warning-subtle: color-mix(in srgb, var(--warning) 10%, transparent);
--warning-border: color-mix(in srgb, var(--warning) 28%, transparent);
--success: oklch(0.7227 0.192 149.577); /* #22c55e */
--success-foreground: oklch(0.2178 0 0); /* #1a1a1a */
--success-subtle: color-mix(in srgb, var(--success) 10%, transparent);
--success-border: color-mix(in srgb, var(--success) 28%, transparent);
--danger: oklch(0.6369 0.2079 25.334); /* #ef4444 */
--danger-foreground: oklch(0.2178 0 0); /* #1a1a1a */
--danger-subtle: color-mix(in srgb, var(--danger) 10%, transparent);
--danger-border: color-mix(in srgb, var(--danger) 28%, transparent);
```

- [ ] **Step 5: Add the `.dark` accent overrides**

In `app/globals.css`, insert this block inside `.dark`, immediately after the `--status-done:` line in the `.dark` block (currently line 578) and before the closing `}` of `.dark`:

```css
/* Semantic feedback accents — brighter in dark, mirroring the prior callout
     dark palette. -foreground / -subtle / -border are NOT overridden: foreground
     stays near-black, and subtle/border re-resolve through these accents +
     --background automatically. */
--info: oklch(0.7137 0.1433 254.621); /* #60a5fa */
--warning: oklch(0.8369 0.1644 84.421); /* #fbbf24 */
--success: oklch(0.8003 0.1821 151.707); /* #4ade80 */
--danger: oklch(0.7106 0.1662 22.222); /* #f87171 */
```

- [ ] **Step 6: Register the tokens in `@theme inline`**

In `app/globals.css`, insert this block inside `@theme inline`, immediately after the `--color-status-done: var(--status-done);` line (currently line 621):

```css
/* Semantic feedback utilities: generates .text-info / .bg-success-subtle /
     .border-warning-border / .text-danger-foreground / etc. */
--color-info: var(--info);
--color-info-foreground: var(--info-foreground);
--color-info-subtle: var(--info-subtle);
--color-info-border: var(--info-border);
--color-warning: var(--warning);
--color-warning-foreground: var(--warning-foreground);
--color-warning-subtle: var(--warning-subtle);
--color-warning-border: var(--warning-border);
--color-success: var(--success);
--color-success-foreground: var(--success-foreground);
--color-success-subtle: var(--success-subtle);
--color-success-border: var(--success-border);
--color-danger: var(--danger);
--color-danger-foreground: var(--danger-foreground);
--color-danger-subtle: var(--danger-subtle);
--color-danger-border: var(--danger-border);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest __tests__/styles/globals-css-color-tokens.test.ts`
Expected: PASS — all token, color-mix, and `.dark` override assertions green.

- [ ] **Step 8: Commit**

```bash
git add app/globals.css __tests__/styles/globals-css-color-tokens.test.ts
git commit -m "feat: add semantic feedback color tokens (info/warning/success/danger) [LUM-258]"
```

---

### Task 2: Re-drive the callout from the tokens

**Files:**

- Modify: `app/globals.css` (lines 195-241 — the variant tint rules)
- Test: `__tests__/styles/globals-css-color-tokens.test.ts`

- [ ] **Step 1: Add the callout-token-driven test (failing test)**

Append this block to the end of `__tests__/styles/globals-css-color-tokens.test.ts`:

```ts
// LUM-258: callout variants are token-driven; the duplicated .dark callout
// palette is gone (subtle/border are translucent and adapt on their own).
describe('callout variants are token-driven', () => {
  it('has no .dark .callout[data-variant] rules', () => {
    expect(css).not.toMatch(/\.dark\s+\.callout\[data-variant/)
  })

  it.each([
    ['info', 'info'],
    ['warning', 'warning'],
    ['success', 'success'],
    ['error', 'danger'], // error variant maps to the danger token family
  ])(
    'callout[data-variant=%s] drives border-left from var(--%s)',
    (variant, token) => {
      const rule =
        css.match(
          new RegExp(`\\.callout\\[data-variant='${variant}'\\]\\s*\\{[^}]*\\}`)
        )?.[0] ?? ''
      expect(rule).toContain(`background-color: var(--${token}-subtle)`)
      expect(rule).toContain(`border-color: var(--${token}-border)`)
      expect(rule).toContain(`border-left-color: var(--${token})`)
    }
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/styles/globals-css-color-tokens.test.ts -t "callout variants are token-driven"`
Expected: FAIL — callout still uses raw hex and the `.dark .callout` block still exists.

- [ ] **Step 3: Rewrite the callout variant block**

In `app/globals.css`, replace the entire block from line 195 (`/* Variant accent tints (light). */`) through line 241 (the closing `}` of `.dark .callout[data-variant='error']`, just before the blank line preceding `/* ── Toggle block`) with:

```css
/* Variant accent tints — token-driven (LUM-258). -subtle / -border are
   translucent, so a single rule per variant works in both light and dark;
   no .dark override needed. */
.callout[data-variant='info'] {
  background-color: var(--info-subtle);
  border-color: var(--info-border);
  border-left-color: var(--info);
}
.callout[data-variant='warning'] {
  background-color: var(--warning-subtle);
  border-color: var(--warning-border);
  border-left-color: var(--warning);
}
.callout[data-variant='success'] {
  background-color: var(--success-subtle);
  border-color: var(--success-border);
  border-left-color: var(--success);
}
.callout[data-variant='note'] {
  background-color: var(--muted);
  border-color: var(--border);
  border-left-color: var(--muted-foreground);
}
.callout[data-variant='error'] {
  background-color: var(--danger-subtle);
  border-color: var(--danger-border);
  border-left-color: var(--danger);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/styles/globals-css-color-tokens.test.ts`
Expected: PASS — full file (token + color-mix + dark + callout tests) green.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css __tests__/styles/globals-css-color-tokens.test.ts
git commit -m "refactor: drive callout variants from feedback tokens, drop .dark dupes [LUM-258]"
```

---

### Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green (notably `__tests__/styles/globals-css-color-tokens.test.ts`).

- [ ] **Step 3: Token lint**

Run: `npm run lint:tokens`
Expected: `✓ lint-tokens: no regressions against baseline`. (`app/globals.css` is allowlisted, so the new hex _comments_ don't count; callout no longer adds hex.)

- [ ] **Step 4: Confirm no stray callout hex remains**

Run: `grep -nE "callout\[data-variant.*#|#[0-9a-fA-F]{3,8}" app/globals.css | grep -i callout`
Expected: no output (all callout color is now `var(--*)`; hex survives only as `/* … */` comments on token definitions, not on callout rules).

- [ ] **Step 5: Visual no-regression (manual, both modes)**

Open a doc with info/warning/success/error/note callouts in light and dark mode; confirm each variant's tint, border, and left accent read correctly and legibly. (Per project note, the local preview browser may be unreachable; if so, rely on the contrast verification in the spec + the passing tests, and flag for reviewer visual check.)

---

## Self-Review

**Spec coverage:**

- New tokens (accent/foreground/subtle/border) in `:root`/`.dark` → Task 1 steps 4-5. ✓
- `@theme inline` registrations → Task 1 step 6. ✓
- Callout token-driven, `.dark` dupes deleted → Task 2. ✓
- `error`→`danger`, `note` neutral → Task 2 step 3. ✓
- Tests (oklch list, color-mix, dark override, callout) → Task 1 steps 1-2, Task 2 step 1. ✓
- `--danger` distinct from `--destructive` (no alias) → Task 1 step 4 defines `--danger` independently. ✓
- Service/email raw colors deferred to LUM-264 → out of scope, no task. ✓
- Contrast / lint / tsc acceptance → Task 3. ✓

**Placeholder scan:** none — every CSS block and test block is complete literal content.

**Type/name consistency:** token names (`--info-subtle`, `--color-info-subtle`, …) and the `error`→`danger` mapping are identical across the `:root` definitions (Task 1 step 4), `@theme` registrations (step 6), callout rules (Task 2 step 3), and all test assertions. oklch values match the spec's verified palette.
