# Typography Scale Implementation Plan [LUM-260]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a six-tier semantic typography scale as Tailwind v4 font-size tokens, route the `Typography*` components through it, and migrate the task detail + task list core pages onto it.

**Architecture:** Tailwind v4.2.2 supports companion modifiers `--text-{name}--line-height`, `--text-{name}--font-weight`, and `--text-{name}--letter-spacing` on a `--text-{name}` font-size token (verified in `node_modules/tailwindcss/dist/lib.js` — the `text-*` utility resolves `["--line-height","--letter-spacing","--font-weight"]`). So one `@theme inline` token per tier emits a `text-{tier}` utility that sets all four properties at once — no `@utility` block needed. Color stays orthogonal (applied separately). Migration is a mechanical class swap; the tiers are calibrated to the rendered size/weight call sites already use, so there is no intended visual change.

**Tech Stack:** Tailwind CSS v4.2.2, Next.js 14 App Router, TypeScript (strict), Jest + Testing Library (jsdom).

**Working directory:** This plan executes in the worktree `.worktrees/LUM-260-typography-scale` (branch `lumo/LUM-260-typography-scale`, off `origin/main`). `node_modules` is symlinked to the main checkout. **All `jest`/`tsc` commands must run with cwd inside this worktree** (per the haste-collision gotcha). Prefix shell steps with `cd .worktrees/LUM-260-typography-scale`.

---

## The Scale (reference for every task)

| Utility            | font-size       | line-height | font-weight | letter-spacing |
| ------------------ | --------------- | ----------- | ----------- | -------------- |
| `text-caption`     | 0.75rem (12px)  | 1.4         | 500         | —              |
| `text-body`        | 0.875rem (14px) | 1.5         | 400         | —              |
| `text-body-strong` | 0.875rem (14px) | 1.5         | 600         | —              |
| `text-title`       | 1rem (16px)     | 1.4         | 600         | -0.01em        |
| `text-heading`     | 1.25rem (20px)  | 1.3         | 600         | -0.01em        |
| `text-display`     | 1.875rem (30px) | 1.2         | 700         | -0.02em        |

**Mechanical migration mapping:**

| Existing class(es)                        | Replace with        |
| ----------------------------------------- | ------------------- |
| `text-xs`                                 | `text-caption`      |
| `text-sm` (plain body)                    | `text-body`         |
| `text-sm font-medium` / `text-sm font-semibold` | `text-body-strong` (drop the `font-*`) |
| `text-base` / `text-lg` title             | `text-title`        |
| `text-xl` / `text-2xl` heading            | `text-heading`      |
| `text-3xl`+ display                       | `text-display`      |

Keep any color class (`text-muted-foreground`, `text-foreground`) untouched. If a call site sets a weight that is NOT the tier default (rare), keep the explicit `font-*` after the tier class.

---

## Task 1: Define the scale tokens in `app/globals.css`

**Files:**
- Modify: `app/globals.css` (inside the `@theme inline` block, after the `--color-status-done` line ~618)
- Test: `__tests__/styles/typography-scale-tokens.test.ts` (create)

- [ ] **Step 1: Write the failing guard test**

Create `__tests__/styles/typography-scale-tokens.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-260: the semantic typography scale is carried by Tailwind v4 font-size
// tokens in app/globals.css. Each tier MUST declare its --text-{tier} size plus
// a --line-height (and the weighted/letter-spaced tiers their --font-weight /
// --letter-spacing companions). Guard against a tier being dropped or renamed,
// which would silently strip hierarchy from every migrated call site.
const TIERS = [
  'caption',
  'body',
  'body-strong',
  'title',
  'heading',
  'display',
] as const

describe('app/globals.css typography scale tokens', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

  it.each(TIERS)('declares --text-%s with a line-height companion', (tier) => {
    expect(css).toMatch(new RegExp(`--text-${tier}:\\s*[\\d.]+rem;`))
    expect(css).toMatch(new RegExp(`--text-${tier}--line-height:`))
  })

  it('declares a font-weight companion for the weighted tiers', () => {
    for (const tier of ['caption', 'body', 'body-strong', 'title', 'heading', 'display']) {
      expect(css).toMatch(new RegExp(`--text-${tier}--font-weight:`))
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest __tests__/styles/typography-scale-tokens.test.ts`
Expected: FAIL — tokens not yet declared (`expect(received).toMatch(...)` errors).

- [ ] **Step 3: Add the tokens to `app/globals.css`**

Inside the `@theme inline { … }` block, immediately after the `--color-status-done: var(--status-done);` line (and before the `/* Landing-specific … */` comment), insert:

```css

  /* ── Semantic typography scale (LUM-260) ────────────────────────────────
     One Tailwind v4 font-size token per tier emits a `text-{tier}` utility
     that bundles font-size + line-height + font-weight + letter-spacing.
     COLOR IS ORTHOGONAL — apply text-muted-foreground / text-foreground etc.
     separately. Migration mapping:
       text-xs                       → text-caption
       text-sm (body)                → text-body
       text-sm font-medium/semibold  → text-body-strong (drop font-*)
       text-base/lg title            → text-title
       text-xl/2xl heading           → text-heading
       text-3xl+ display             → text-display
     Full reference: docs/design-system/typography-scale.md */
  --text-caption: 0.75rem;
  --text-caption--line-height: 1.4;
  --text-caption--font-weight: 500;

  --text-body: 0.875rem;
  --text-body--line-height: 1.5;
  --text-body--font-weight: 400;

  --text-body-strong: 0.875rem;
  --text-body-strong--line-height: 1.5;
  --text-body-strong--font-weight: 600;

  --text-title: 1rem;
  --text-title--line-height: 1.4;
  --text-title--font-weight: 600;
  --text-title--letter-spacing: -0.01em;

  --text-heading: 1.25rem;
  --text-heading--line-height: 1.3;
  --text-heading--font-weight: 600;
  --text-heading--letter-spacing: -0.01em;

  --text-display: 1.875rem;
  --text-display--line-height: 1.2;
  --text-display--font-weight: 700;
  --text-display--letter-spacing: -0.02em;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest __tests__/styles/typography-scale-tokens.test.ts`
Expected: PASS (all tiers found).

- [ ] **Step 5: Confirm the color-token guard still passes (no hex wrapped in hsl/rgb)**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest __tests__/styles/globals-css-color-tokens.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/LUM-260-typography-scale
git add app/globals.css __tests__/styles/typography-scale-tokens.test.ts
git commit -m "feat: define semantic typography scale tokens [LUM-260]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Re-point the `Typography*` components at the new tiers

**Files:**
- Modify: `components/ui/typography.tsx`
- Test: `__tests__/components/ui/typography.test.tsx` (extend)

Goal: the app-relevant components emit tier classes (the "component promotion" half), while preserving every prop contract (`align`, `balance`, `className`, attr passthrough). Heading components map: H1→`text-display`, H2/H3→`text-heading`, H4→`text-title`, H5/H6→`text-title`. Body helpers: `TypographyP`→`text-body`, `TypographySmall`→`text-caption`, `TypographyMuted`→`text-caption`, `TypographyLarge`→`text-title`, `TypographyLead`→`text-heading`. Prose-structure styling (margins, list/blockquote spacing, `scroll-m-20`, `first:mt-0`, border) is retained — only the size/weight/leading source changes.

- [ ] **Step 1: Extend the test to assert tier classes**

Append to `__tests__/components/ui/typography.test.tsx` (inside the file, after the existing `describe('TypographyH1', …)` block):

```tsx
import {
  TypographyH1 as H1,
  TypographyH2,
  TypographyH3,
  TypographyH4,
  TypographyP,
  TypographySmall,
  TypographyMuted,
} from '@/components/ui/typography'

describe('Typography tier mapping (LUM-260)', () => {
  it('H1 uses text-display and keeps tracking-tight', () => {
    render(<H1>Display</H1>)
    const el = screen.getByRole('heading', { level: 1 })
    expect(el.className).toContain('text-display')
    expect(el.className).not.toContain('text-4xl')
  })

  it('H2 and H3 use text-heading', () => {
    render(<TypographyH2>Two</TypographyH2>)
    render(<TypographyH3>Three</TypographyH3>)
    expect(screen.getByRole('heading', { level: 2 }).className).toContain(
      'text-heading'
    )
    expect(screen.getByRole('heading', { level: 3 }).className).toContain(
      'text-heading'
    )
  })

  it('H4 uses text-title', () => {
    render(<TypographyH4>Four</TypographyH4>)
    expect(screen.getByRole('heading', { level: 4 }).className).toContain(
      'text-title'
    )
  })

  it('TypographyP uses text-body', () => {
    render(<TypographyP>Body</TypographyP>)
    expect(screen.getByText('Body').className).toContain('text-body')
  })

  it('TypographySmall and TypographyMuted use text-caption', () => {
    render(<TypographySmall>Small</TypographySmall>)
    render(<TypographyMuted>Muted</TypographyMuted>)
    expect(screen.getByText('Small').className).toContain('text-caption')
    expect(screen.getByText('Muted').className).toContain('text-caption')
    // Muted keeps its color class
    expect(screen.getByText('Muted').className).toContain('text-muted-foreground')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest __tests__/components/ui/typography.test.tsx`
Expected: FAIL — components still emit `text-4xl`/`text-sm`/etc.

- [ ] **Step 3: Update the component class strings**

In `components/ui/typography.tsx`, change only the size/weight portions:

- `TypographyH1`: `'scroll-m-20 text-4xl font-extrabold tracking-tight'` → `'scroll-m-20 text-display tracking-tight'`
- `TypographyH2`: `'scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0'` → `'scroll-m-20 border-b pb-2 text-heading tracking-tight first:mt-0'`
- `TypographyH3`: `'scroll-m-20 text-2xl font-semibold tracking-tight'` → `'scroll-m-20 text-heading tracking-tight'`
- `TypographyH4`: `'scroll-m-20 text-xl font-semibold tracking-tight'` → `'scroll-m-20 text-title tracking-tight'`
- `TypographyH5`: `'scroll-m-20 text-lg font-semibold tracking-tight'` → `'scroll-m-20 text-title tracking-tight'`
- `TypographyH6`: `'scroll-m-20 text-base font-semibold tracking-tight'` → `'scroll-m-20 text-title tracking-tight'`
- `TypographyP`: `'leading-7 [&:not(:first-child)]:mt-6'` → `'text-body [&:not(:first-child)]:mt-6'`
- `TypographyLead`: `'text-muted-foreground text-xl'` → `'text-muted-foreground text-heading'`
- `TypographyLarge`: `'text-lg font-semibold'` → `'text-title'`
- `TypographySmall`: `'text-sm leading-none font-medium'` → `'text-caption leading-none'`
- `TypographyMuted`: `'text-muted-foreground text-sm'` → `'text-muted-foreground text-caption'`
- `TypographyInlineCode`: keep `text-sm` (code prose tied to surrounding flow — out of scope; leave as-is)
- `TypographyCode`: keep `text-sm` (same reason)

(The `tracking-tight` on headings is redundant with the tiers' negative letter-spacing but harmless and kept to avoid touching prose idioms; do not remove it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest __tests__/components/ui/typography.test.tsx`
Expected: PASS (existing H1 prop-contract tests + new tier tests all green).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-260-typography-scale
git add components/ui/typography.tsx __tests__/components/ui/typography.test.tsx
git commit -m "refactor: route Typography components through semantic tiers [LUM-260]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Migrate the task list (columns)

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx`

Apply the mechanical mapping to every `text-xs`/`text-sm` occurrence. Representative changes (verify each line against the current file — line numbers drift):

- `text-xs text-muted-foreground` → `text-caption text-muted-foreground` (project cell, priority, assignee, updated-time, etc.)
- `text-xs font-mono text-muted-foreground` → `text-caption font-mono text-muted-foreground`
- `text-sm font-medium bg-transparent …` (inline title input) → `text-body-strong bg-transparent …` (drop `font-medium`)
- standalone `text-xs` inside `cn(...)` arrays → `text-caption`
- The SortableHeader button class `'… shadow-none text-xs'` → `'… shadow-none text-caption'`

- [ ] **Step 1: Apply the swaps**

Edit each `text-xs`/`text-sm`(+weight) occurrence in `task-columns.tsx` per the mapping table at the top of this plan. Leave all color classes and layout classes intact.

- [ ] **Step 2: Verify no raw `text-xs`/`text-sm` remain**

Run: `cd .worktrees/LUM-260-typography-scale && grep -nE "text-(xs|sm)\b" "app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx"`
Expected: no output (empty).

- [ ] **Step 3: Type-check the file's package compiles (defer full tsc to Task 6)**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest app/workspace 2>/dev/null; echo "columns edited"`
(There may be no direct jest test for columns; this step is a smoke marker — full verification is Task 6.)

- [ ] **Step 4: Commit**

```bash
cd .worktrees/LUM-260-typography-scale
git add "app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx"
git commit -m "refactor: migrate task list columns to typography tiers [LUM-260]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Migrate the task detail page tree

**Files (modify — each has `text-xs`/`text-sm` per the audit):**
- `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkCard.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SlackContextCard.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/FigmaLinkCard.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActorMention.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextSection.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/*.tsx` (WebLinkSection, SlackContextSection, PullRequestsSection, FigmaSection, DocumentsSection)
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/*.tsx` (PrItem, CompactActivityItem, CommentTimelineItem, AgentRunItem)

- [ ] **Step 1: Apply the mechanical mapping across the tree**

For each file above, replace `text-xs`/`text-sm`(+ matching weight) per the mapping table. Keep color/layout classes. For `text-sm font-medium`/`font-semibold` use `text-body-strong` and drop the weight; for plain `text-sm` use `text-body`; for `text-xs` use `text-caption`.

- [ ] **Step 2: Verify no raw `text-xs`/`text-sm` remain in the detail tree**

Run:
```bash
cd .worktrees/LUM-260-typography-scale
grep -rnE "text-(xs|sm)\b" \
  "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx" \
  "app/workspace/[workspaceUrl]/components/TaskDetailTimeline"
```
Expected: no output (empty).

- [ ] **Step 3: Run any existing TaskDetailTimeline tests**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest TaskDetailTimeline 2>/dev/null; echo "detail migrated"`
Expected: PASS (or "no tests found" — acceptable; full verification in Task 6).

- [ ] **Step 4: Commit**

```bash
cd .worktrees/LUM-260-typography-scale
git add "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx" "app/workspace/[workspaceUrl]/components/TaskDetailTimeline"
git commit -m "refactor: migrate task detail page to typography tiers [LUM-260]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Document the scale

**Files:**
- Create: `docs/design-system/typography-scale.md`

- [ ] **Step 1: Write the reference doc**

Create `docs/design-system/typography-scale.md`:

```markdown
# Typography Scale

Six semantic tiers carried as Tailwind v4 font-size tokens in `app/globals.css`.
Each `text-{tier}` utility bundles font-size + line-height + font-weight +
letter-spacing. **Color is orthogonal** — apply `text-muted-foreground` /
`text-foreground` separately.

| Utility            | size  | weight        | line-height | letter-spacing | Use                                                       |
| ------------------ | ----- | ------------- | ----------- | -------------- | --------------------------------------------------------- |
| `text-caption`     | 12px  | medium (500)  | 1.4         | —              | metadata, timestamps, labels, secondary table columns     |
| `text-body`        | 14px  | normal (400)  | 1.5         | —              | default body — table cells, descriptions, most text       |
| `text-body-strong` | 14px  | semibold (600)| 1.5         | —              | emphasized body, row titles, form labels                  |
| `text-title`       | 16px  | semibold (600)| 1.4         | -0.01em        | card titles, section titles                               |
| `text-heading`     | 20px  | semibold (600)| 1.3         | -0.01em        | page / panel main heading                                 |
| `text-display`     | 30px  | bold (700)    | 1.2         | -0.02em        | hero, large empty-state copy (low frequency)              |

## When to use which

- Reach for a tier instead of hand-combining `text-sm font-medium text-foreground`.
- Pick the tier by **role** (is this a caption? a body line? a section title?), not by pixel size.
- Need a non-default weight on a tier (rare)? Add an explicit `font-*` after the tier class.

## Migration mapping (from raw utilities)

| Old                                       | New                |
| ----------------------------------------- | ------------------ |
| `text-xs`                                 | `text-caption`     |
| `text-sm` (body)                          | `text-body`        |
| `text-sm font-medium` / `font-semibold`   | `text-body-strong` |
| `text-base` / `text-lg` title             | `text-title`       |
| `text-xl` / `text-2xl` heading            | `text-heading`     |
| `text-3xl`+ display                       | `text-display`     |

## Components

`components/ui/typography.tsx` is routed through these tiers:
`TypographyH1`→display, `H2`/`H3`→heading, `H4`–`H6`→title, `TypographyP`→body,
`TypographySmall`/`TypographyMuted`→caption.

## Status

Established in LUM-260. Core pages migrated: task detail, task list. Remaining
pages (settings, landing, doc editor) and a lint rule forbidding raw `text-xs/sm`
are deferred to later Design-System-Rework tasks.
```

- [ ] **Step 2: Commit**

```bash
cd .worktrees/LUM-260-typography-scale
git add docs/design-system/typography-scale.md
git commit -m "docs: typography scale reference [LUM-260]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification & PR

- [ ] **Step 1: Run the full typography + styles test suites**

Run: `cd .worktrees/LUM-260-typography-scale && npx jest __tests__/styles __tests__/components/ui/typography.test.tsx`
Expected: PASS.

- [ ] **Step 2: Type-check (run `prisma generate` first to avoid stale-client false errors)**

Run: `cd .worktrees/LUM-260-typography-scale && npx prisma generate && npx tsc --noEmit`
Expected: no errors. (Pure className edits should not affect types; this catches any accidental JSX breakage.)

- [ ] **Step 3: token-lint (no raw hex/zinc introduced)**

Run: `cd .worktrees/LUM-260-typography-scale && npm run lint:tokens`
Expected: PASS (this task introduces only semantic `text-{tier}` + existing semantic color classes; no new hex). If it flags a pre-existing baseline line we did not touch, leave it; do NOT `--update` for anything this task added.

- [ ] **Step 4: Sweep — confirm core pages are clear of raw body utilities**

Run:
```bash
cd .worktrees/LUM-260-typography-scale
grep -rnE "text-(xs|sm)\b" \
  "app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx" \
  "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx" \
  "app/workspace/[workspaceUrl]/components/TaskDetailTimeline" || echo "CLEAN"
```
Expected: `CLEAN`.

- [ ] **Step 5: Push and open the PR**

```bash
cd .worktrees/LUM-260-typography-scale
git push -u origin lumo/LUM-260-typography-scale
gh pr create --title "feat: semantic typography scale + Typography component promotion [LUM-260]" \
  --body "$(cat <<'EOF'
## Summary
Establishes a six-tier semantic typography scale (`text-caption` … `text-display`) as Tailwind v4 font-size tokens, routes the `Typography*` components through it, and migrates the task detail + task list core pages off raw `text-xs/sm`.

- Tiers bundle size + line-height + font-weight + letter-spacing in one class; color stays orthogonal.
- No intended visual change — tiers calibrated to existing rendered size/weight.
- Docs: `docs/design-system/typography-scale.md`.

## Out of scope (later Design-System-Rework tasks)
- Full `text-*` convergence on settings / landing / doc editor.
- A lint rule forbidding raw `text-xs/sm`.
- Any color-token changes.

## Testing
- [x] `__tests__/styles/typography-scale-tokens.test.ts` guards the tokens
- [x] `__tests__/components/ui/typography.test.tsx` asserts tier mapping + prop contracts
- [x] `npx tsc --noEmit` clean
- [x] `npm run lint:tokens` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Verify no migration files were touched / deleted in the diff**

Run: `cd .worktrees/LUM-260-typography-scale && git diff --stat origin/main..HEAD | grep -i "prisma/migrations" || echo "no migration changes (good)"`
Expected: `no migration changes (good)`.

---

## Self-Review notes

- **Spec coverage:** scale definition (Task 1) · component promotion (Task 2) · task list rollout (Task 3) · task detail rollout (Task 4) · documentation (Task 5) · tests + verification (Tasks 1/2/6). All spec sections mapped.
- **No DB / i18n / API changes** — pure styling, so no locale-parity or migration steps needed (the untrusted team-memory migration warnings do not apply to this task).
- **Tailwind v4 risk resolved:** companion modifiers verified supported in 4.2.2; no `@utility` needed.
