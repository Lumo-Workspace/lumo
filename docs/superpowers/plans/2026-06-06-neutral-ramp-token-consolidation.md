# Neutral Ramp Token Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a primitive neutral color ramp (`--gray-0…--gray-12`) and rewrite every neutral semantic token as a `var(--gray-N)` derivation, so the app's whole neutral character is retuned from ~13 seeds instead of ~23 scattered oklch literals.

**Architecture:** Two-tier design tokens. Tier 1 = mode-independent oklch ramp in `:root` (no `.dark` override). Tier 2 = existing neutral semantic tokens rewritten to reference the ramp, picking a light step in `:root` and a dark step in `.dark`. Chromatic tokens (status/priority/feedback/chart/hljs), fonts, focus-ring, and landing.css are untouched.

**Tech Stack:** Tailwind CSS v4 (`@theme inline`), oklch color tokens, Jest guard tests under `__tests__/styles/`.

**Spec:** [docs/superpowers/specs/2026-06-06-neutral-ramp-token-consolidation-design.md](../specs/2026-06-06-neutral-ramp-token-consolidation-design.md) · Task **LUM-294** · Branch `lumo/LUM-294-neutral-ramp-tokens` (already created off `origin/main`).

---

## File Structure

| File                                                | Change                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/globals.css`                                   | Add Tier-1 ramp at top of `:root`; rewrite 23 neutral semantic tokens in `:root` + `.dark` to `var(--gray-N)`. No `@theme inline` change (the `--color-*` registrations already point at the semantic tokens; the ramp is consumed only via `var()`, so it gets no `--color-gray-*` registration and no Tailwind utility). |
| `__tests__/styles/token-parity.test.ts`             | Add `gray-0…gray-12` to `SINGLE_SOURCE_ALLOWLIST`.                                                                                                                                                                                                                                                                         |
| `__tests__/styles/globals-css-color-tokens.test.ts` | Split the single "every token is literal oklch" contract into: neutral subset → `var(--gray-N)`; chromatic subset → oklch; ramp steps → single literal oklch.                                                                                                                                                              |
| `__tests__/styles/feedback-contrast.test.ts`        | Make `resolve()` follow one level of `var(--gray-N)` indirection so `--background` still resolves to an oklch literal.                                                                                                                                                                                                     |

**Not touched (verify, don't edit):** `components/design-system/data/tokens.ts` + `design-system-catalog-parity.test.ts` (they scan `--color-*` in `@theme inline`, which is unchanged); `components/landing/landing.css`; all chromatic token blocks; `--focus-ring`/`--ring`/`--sidebar-ring`; `--radius`; elevation/motion/z-index/control-size/typography tokens.

---

## Reference: the exact target values

**Tier-1 ramp** (insert verbatim into `:root`):

```css
/* ── Primitive neutral ramp (LUM-294) ──────────────────────────────────────
     Mode-INDEPENDENT raw grayscale seeds — one cool neutral hue (255) with a
     gentle chroma taper. The single source for every neutral SURFACE/TEXT color:
     the semantic neutral tokens below (--background, --card, --muted, --border,
     --sidebar*, …) are all var(--gray-N) references that pick a light step in
     :root and a dark step in .dark. To retune the app's overall lightness /
     surface separation / neutral cast, edit these 13 steps — nothing else.
     No .dark override (primitives are identical in both schemes; the SEMANTIC
     layer is what remaps per mode). Allowlisted in token-parity.test.ts. */
--gray-0: oklch(1 0 0);
--gray-1: oklch(0.984 0.004 255);
--gray-2: oklch(0.967 0.006 255);
--gray-3: oklch(0.928 0.01 255);
--gray-4: oklch(0.845 0.013 255);
--gray-5: oklch(0.705 0.02 255);
--gray-6: oklch(0.627 0.022 255);
--gray-7: oklch(0.554 0.03 255);
--gray-8: oklch(0.37 0.018 255);
--gray-9: oklch(0.283 0.01 255);
--gray-10: oklch(0.218 0.006 255);
--gray-11: oklch(0.172 0.004 255);
--gray-12: oklch(0.145 0.002 255);
```

**Tier-2 neutral aliases** (each token's new value in `:root` and `.dark`):

| Token                          | `:root` value    | `.dark` value    |
| ------------------------------ | ---------------- | ---------------- |
| `--background`                 | `var(--gray-0)`  | `var(--gray-12)` |
| `--foreground`                 | `var(--gray-10)` | `var(--gray-0)`  |
| `--card`                       | `var(--gray-0)`  | `var(--gray-11)` |
| `--card-foreground`            | `var(--gray-10)` | `var(--gray-0)`  |
| `--popover`                    | `var(--gray-0)`  | `var(--gray-10)` |
| `--popover-foreground`         | `var(--gray-10)` | `var(--gray-0)`  |
| `--primary`                    | `var(--gray-10)` | `var(--gray-0)`  |
| `--primary-foreground`         | `var(--gray-0)`  | `var(--gray-12)` |
| `--secondary`                  | `var(--gray-1)`  | `var(--gray-10)` |
| `--secondary-foreground`       | `var(--gray-10)` | `var(--gray-0)`  |
| `--muted`                      | `var(--gray-2)`  | `var(--gray-10)` |
| `--muted-foreground`           | `var(--gray-7)`  | `var(--gray-6)`  |
| `--accent`                     | `var(--gray-2)`  | `var(--gray-9)`  |
| `--accent-foreground`          | `var(--gray-10)` | `var(--gray-2)`  |
| `--border`                     | `var(--gray-3)`  | `var(--gray-9)`  |
| `--input`                      | `var(--gray-0)`  | `var(--gray-10)` |
| `--sidebar`                    | `var(--gray-1)`  | `var(--gray-11)` |
| `--sidebar-foreground`         | `var(--gray-10)` | `var(--gray-0)`  |
| `--sidebar-primary`            | `var(--gray-10)` | `var(--gray-0)`  |
| `--sidebar-primary-foreground` | `var(--gray-0)`  | `var(--gray-12)` |
| `--sidebar-accent`             | `var(--gray-2)`  | `var(--gray-10)` |
| `--sidebar-accent-foreground`  | `var(--gray-10)` | `var(--gray-0)`  |
| `--sidebar-border`             | `var(--gray-3)`  | `var(--gray-9)`  |

> **Do NOT change** `--destructive` / `--destructive-foreground` (red, chromatic), `--focus-ring`, `--ring`, `--sidebar-ring`, `--radius`, or any elevation/status/feedback/priority/chart/hljs line. Leave every existing explanatory comment in place — only swap the value on the listed neutral lines, and add the ramp block.

---

## Task 1: Add the primitive ramp + allowlist it

**Files:**

- Modify: `app/globals.css` (top of `:root`, currently line 447)
- Modify: `__tests__/styles/token-parity.test.ts:49-77` (`SINGLE_SOURCE_ALLOWLIST`)

- [ ] **Step 1: Insert the ramp block into `:root`**

In `app/globals.css`, find the `:root {` opening (line 447) and the first base-token comment line that follows it:

```css
:root {
  /* Base tokens — oklch (single color model, shared with landing.css).
```

Insert the full **Tier-1 ramp** block (from the Reference section above) between `:root {` and that `/* Base tokens … */` comment.

- [ ] **Step 2: Run the parity guard — verify it FAILS**

Run: `npm test -- __tests__/styles/token-parity.test.ts`
Expected: FAIL. 13 cases like `--gray-0 has a .dark override or is an allowlisted single source` fail — the ramp is in `:root`, has no `.dark` override, and isn't allowlisted yet. (This proves the guard works.)

- [ ] **Step 3: Allowlist the ramp steps**

In `__tests__/styles/token-parity.test.ts`, inside the `SINGLE_SOURCE_ALLOWLIST` object (after the `priority-urgent` entry, before the closing `}`), add:

```ts
  // LUM-294: primitive neutral ramp — mode-independent raw grayscale seeds. The
  // semantic neutral tokens (background/card/muted/border/sidebar*/…) derive
  // from these via var(--gray-N) and keep their own per-mode overrides, so only
  // the ramp steps themselves are single-source.
  'gray-0': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-1': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-2': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-3': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-4': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-5': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-6': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-7': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-8': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-9': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-10': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-11': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
  'gray-12': 'primitive neutral ramp step, mode-independent raw value (LUM-294)',
```

- [ ] **Step 4: Run the parity + color-token + contrast guards — verify PASS**

Run: `npm test -- __tests__/styles/token-parity.test.ts __tests__/styles/globals-css-color-tokens.test.ts __tests__/styles/feedback-contrast.test.ts`
Expected: PASS. Parity now passes (ramp allowlisted). color-tokens still passes (ramp isn't in its `COLOR_TOKENS` list; neutrals are still literal oklch at this point). feedback-contrast still passes (neutrals still oklch).

- [ ] **Step 5: Commit**

```bash
git add app/globals.css __tests__/styles/token-parity.test.ts
git commit -m "feat: add primitive neutral gray ramp seeds [LUM-294]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewrite neutral semantic tokens as ramp derivations

**Files:**

- Modify: `__tests__/styles/globals-css-color-tokens.test.ts:28-93` (contract split)
- Modify: `__tests__/styles/feedback-contrast.test.ts:54-60` (`resolve()` deref)
- Modify: `app/globals.css` (`:root` lines ~452-495 and `.dark` lines ~591-617 — neutral tokens only)

- [ ] **Step 1: Rewrite the color-token contract test**

In `__tests__/styles/globals-css-color-tokens.test.ts`, replace everything from the `const COLOR_TOKENS = [` line (28) through the end of its `describe.each(COLOR_TOKENS)(...)` block (line 93) with:

```ts
// LUM-294: neutral semantic tokens DERIVE from the primitive --gray-* ramp —
// they are per-mode var(--gray-N) references, not literal oklch. The ramp steps
// carry the literal oklch (asserted separately below). Chromatic tokens stay
// literal oklch (contrast-tuned per mode, LUM-257).
const NEUTRAL_TOKENS = [
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
  'border',
  'input',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
] as const

const CHROMATIC_TOKENS = [
  'destructive',
  'destructive-foreground',
  // LUM-262: single brand-blue focus accent (kept oklch, defined once in :root).
  'focus-ring',
  'status-todo',
  'status-in-progress',
  'status-in-review',
  'status-done',
  // LUM-258 semantic feedback colors.
  'info',
  'info-foreground',
  'warning',
  'warning-foreground',
  'success',
  'success-foreground',
  'danger',
  'danger-foreground',
  // LUM-263 priority colors.
  'priority-urgent',
  'priority-high',
  'priority-medium',
  'priority-low',
] as const

const RAMP_TOKENS = Array.from({ length: 13 }, (_, i) => `gray-${i}`)

/** Every definition of a token (`--token: …;`), trimmed. */
function defsOf(token: string): string[] {
  return [...css.matchAll(new RegExp(`--${token}:\\s*([^;]+);`, 'g'))].map(m =>
    (m[1] ?? '').trim()
  )
}

describe.each(NEUTRAL_TOKENS)('neutral --%s', token => {
  const defs = defsOf(token)

  it('is defined at least once', () => {
    expect(defs.length).toBeGreaterThan(0)
  })

  it('every definition derives from the gray ramp (var(--gray-N))', () => {
    for (const value of defs) {
      expect(value).toMatch(/^var\(--gray-\d+\)$/)
    }
  })
})

describe.each(CHROMATIC_TOKENS)('chromatic --%s', token => {
  const defs = defsOf(token)

  it('is defined at least once', () => {
    expect(defs.length).toBeGreaterThan(0)
  })

  it('every definition is an oklch() value, never a hex literal', () => {
    for (const value of defs) {
      expect(value).toMatch(/^oklch\(/)
      expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })
})

describe.each(RAMP_TOKENS)('ramp --%s', token => {
  const defs = defsOf(token)

  it('is defined exactly once (mode-independent primitive, no .dark override)', () => {
    expect(defs).toHaveLength(1)
  })

  it('is a literal oklch() value, never a hex literal', () => {
    expect(defs[0]).toMatch(/^oklch\(/)
    expect(defs[0]).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
```

Leave the rest of the file (from line 95 onward: the focus-ring single-source block, the `-subtle`/`-border` color-mix block, `.dark` feedback overrides, priority tokens, callout variants) **unchanged**.

- [ ] **Step 2: Run the color-token test — verify it FAILS**

Run: `npm test -- __tests__/styles/globals-css-color-tokens.test.ts`
Expected: FAIL. The `neutral --background … every definition derives from the gray ramp` cases fail — globals.css neutrals are still literal oklch. (Proves the new contract is active.)

- [ ] **Step 3: Make the contrast test follow ramp indirection**

In `__tests__/styles/feedback-contrast.test.ts`, replace the `resolve` function (lines 54-60):

```ts
/** Resolve a token to its value in a mode: .dark override if present, else :root. */
function resolve(token: string, mode: Mode): string {
  const value =
    mode === 'dark'
      ? (rawValue(DARK, token) ?? rawValue(ROOT, token))
      : rawValue(ROOT, token)
  if (value == null) throw new Error(`token --${token} not defined`)
  return value
}
```

with:

```ts
/**
 * Resolve a token to its value in a mode: .dark override if present, else :root.
 * LUM-294: neutral tokens (e.g. --background) now derive from the primitive
 * --gray-* ramp, so follow one level of var(--gray-N) indirection to the ramp's
 * oklch literal (the ramp is defined in :root, mode-independent).
 */
function resolve(token: string, mode: Mode): string {
  const value =
    mode === 'dark'
      ? (rawValue(DARK, token) ?? rawValue(ROOT, token))
      : rawValue(ROOT, token)
  if (value == null) throw new Error(`token --${token} not defined`)
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/)
  if (ref?.[1]) return resolve(ref[1], mode)
  return value
}
```

- [ ] **Step 4: Run the contrast test — verify still PASS**

Run: `npm test -- __tests__/styles/feedback-contrast.test.ts`
Expected: PASS (no `var()` neutrals in globals.css yet, so the deref is a no-op; this change is safe to land before the CSS rewrite).

- [ ] **Step 5: Rewrite the neutral tokens in `app/globals.css`**

For each token in the **Tier-2 neutral aliases** table (Reference section), replace its value on the existing line in `:root` with the `:root` column value, and on the existing line in `.dark` with the `.dark` column value. Edit only the value after the colon; keep every surrounding comment. Example for `--background`:

```css
/* :root — was:  --background: oklch(1 0 0); */
--background: var(--gray-0);
/* .dark — was:  --background: oklch(0.1448 0 0); */
--background: var(--gray-12);
```

Apply the same per-line swap to all 23 neutral tokens. Do not touch `--destructive*`, `--focus-ring`, `--ring`, `--sidebar-ring`, `--radius`, or any chromatic/elevation/etc. line.

- [ ] **Step 6: Run the three affected guards — verify PASS**

Run: `npm test -- __tests__/styles/globals-css-color-tokens.test.ts __tests__/styles/token-parity.test.ts __tests__/styles/feedback-contrast.test.ts`
Expected: PASS all three. color-tokens: neutrals now `var(--gray-N)`, chromatic still oklch, ramp single literal. parity: neutrals have real `.dark` overrides, ramp allowlisted. contrast: `--background` derefs through the ramp to an oklch literal.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css __tests__/styles/globals-css-color-tokens.test.ts __tests__/styles/feedback-contrast.test.ts
git commit -m "feat: derive neutral semantic tokens from the gray ramp [LUM-294]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Full verification

**Files:** none (verification + any contrast tuning).

- [ ] **Step 1: Run the full styles suite**

Run: `npm test -- __tests__/styles`
Expected: every suite passes **except one pre-existing, unrelated failure** that must remain unchanged: `design-system-catalog-parity.test.ts` ("every globals.css `--color-*` token is in the catalog registry") fails because `--color-chart-1…5` (registered in `@theme inline` since LUM-290) were never added to `CATALOG_COLOR_TOKENS`. This is red on `origin/main` too — **do NOT fix it here** (out of scope; tracked separately). Confirm it is the ONLY failure and that its failure is identical to base (`git stash` your changes is unnecessary — just verify the failing assertion is the chart-token one, not anything touching neutrals/gray). Our change adds no `--color-gray-*` registration, so it cannot affect this test.

- [ ] **Step 2: Verify muted-foreground contrast (not covered by a guard test)**

`--muted-foreground` is secondary body text; it must clear AA 4.5:1 on `--background` in both modes. The contrast test doesn't assert it, so verify manually with the same oklch pipeline. Run:

```bash
node -e '
function lum(L,C,H){const hr=H*Math.PI/180,a=C*Math.cos(hr),b=C*Math.sin(hr);
const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,s=(L-0.0894841775*a-1.291485548*b)**3;
let r=4.0767416621*l-3.3077115913*m+0.2309699292*s,g=-1.2684380046*l+2.6097574011*m-0.3413193965*s,bl=-0.0041960863*l-0.7034186147*m+1.707614701*s;
[r,g,bl]=[r,g,bl].map(x=>Math.min(1,Math.max(0,x)));return 0.2126*r+0.7152*g+0.0722*bl;}
const cr=(a,b)=>{const hi=Math.max(a,b),lo=Math.min(a,b);return (hi+0.05)/(lo+0.05);};
// light: muted-foreground gray-7 on background gray-0
console.log("light", cr(lum(0.554,0.03,255), lum(1,0,0)).toFixed(2));
// dark: muted-foreground gray-6 on background gray-12
console.log("dark", cr(lum(0.627,0.022,255), lum(0.145,0.002,255)).toFixed(2));
'
```

Expected: both ≥ 4.5. If either is below, lower `--gray-7` lightness (light) / raise `--gray-6` lightness (dark) by ~0.02 in `app/globals.css`, re-run this check and the styles suite, then amend.

- [ ] **Step 3: Type-check and token lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint:tokens`
Expected: clean — no new raw-color offenders (the ramp lives in globals.css, the sanctioned token home).

- [ ] **Step 4: Production build (the only CI gate is the Vercel build)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit any tuning (skip if Steps 2-4 needed no change)**

```bash
git add app/globals.css
git commit -m "fix: tune neutral ramp for AA contrast [LUM-294]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Tier-1 ramp → Task 1. Tier-2 aliases → Task 2 Step 5. Guard-test updates (all 3) → Tasks 1-2. Accepted visual change (muted-foreground) → Task 3 Step 2 verifies it stays ≥4.5:1. Out-of-scope items confirmed untouched via the "Do NOT change" list + catalog note.
- **Discovered beyond the spec:** the spec named 2 test updates; implementation found a **third** — `feedback-contrast.test.ts` reads `--background` and parses it as plain oklch, so it needs the `var()` deref (Task 2 Step 3). The spec's catalog concern resolved to "no change needed" (catalog scans `--color-*` only).
- **Type/name consistency:** `defsOf` (color-tokens test), `resolve`/`rawValue` (contrast test), `var(--gray-N)` value strings, and ramp values match across all tasks and the spec tables.
- **Branch:** all commits land on `lumo/LUM-294-neutral-ramp-tokens`; open a PR titled `feat: consolidate neutral color tokens into a primitive gray ramp [LUM-294]` after Task 3. No schema/migration; PR body notes "no production action required".
