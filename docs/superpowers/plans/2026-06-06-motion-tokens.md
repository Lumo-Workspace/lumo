# Motion Tokens (duration/easing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `--transition-duration-fast/base/slow` + `--ease-standard/emphasized` tokens in `app/globals.css` `@theme inline`, then migrate scattered app-code durations/easings onto them, guarded by a styles test.

**Architecture:** Tailwind v4 native theme namespaces — `duration-*` resolves named values from `--transition-duration-*`, `ease-*` from `--ease-*`. So plain `@theme` registration emits `duration-fast/base/slow` + `ease-standard/emphasized` utilities; no `@utility` or arbitrary-value syntax. Scope is **app business code only**; `components/ui/*` (vendored shadcn) and `components/landing/*` are left untouched.

**Tech Stack:** Tailwind CSS v4.2.2, Next.js 14, TypeScript, Jest.

**Worktree:** `.worktrees/LUM-284-motion-tokens` (branch `lumo/LUM-284-motion-tokens`). Run all `git`/`jest`/`tsc` commands from INSIDE this worktree (`cd` first — the cli/package.json haste collision otherwise runs the wrong tests). Paths below are relative to the worktree root.

---

### Task 1: Register motion tokens + guard test (TDD)

**Files:**
- Create: `__tests__/styles/motion-tokens.test.ts`
- Modify: `app/globals.css` (insert after line 765, `--text-display--letter-spacing: -0.02em;`, still inside the `@theme inline {` block that opens at line 656)

- [ ] **Step 1: Write the failing guard test**

Create `__tests__/styles/motion-tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-284: motion (transition duration + easing) has a single source of truth
// in the globals.css `@theme inline` block. duration-* utilities resolve named
// values from --transition-duration-*; ease-* from --ease-* (Tailwind v4 native
// namespaces). Guard that all five tokens exist with well-formed values so a
// refactor can't silently drop or rename them.
//
// NOTE: this file parses globals.css as raw text with a non-nesting `[^}]*`
// grab of the @theme block, exactly like the sibling color/typography guards.
// Keep the motion token COMMENT free of `{` `}` and the literal `@theme inline`
// or this and the other styles guards break (prior globals.css guard hazard).

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

function themeInlineBlock(): string {
  // First `{ … }` group after `@theme inline`. The block contains no nested
  // braces, so a non-greedy `[^}]*` is safe.
  const m = css.match(/@theme inline\s*\{([^}]*)\}/)
  if (!m?.[1]) throw new Error('could not find @theme inline block in globals.css')
  return m[1]
}

describe('motion tokens (LUM-284)', () => {
  const block = themeInlineBlock()

  it.each(['fast', 'base', 'slow'])(
    '--transition-duration-%s is registered as an ms value',
    (tier) => {
      const m = block.match(
        new RegExp(`--transition-duration-${tier}:\\s*(\\d+)ms`)
      )
      expect(m?.[1]).toBeDefined()
    }
  )

  it.each(['standard', 'emphasized'])(
    '--ease-%s is registered as a cubic-bezier curve',
    (name) => {
      const m = block.match(
        new RegExp(`--ease-${name}:\\s*cubic-bezier\\([^)]*\\)`)
      )
      expect(m).not.toBeNull()
    }
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .worktrees/LUM-284-motion-tokens && npx jest __tests__/styles/motion-tokens.test.ts`
Expected: FAIL — all five assertions fail (tokens not yet in globals.css).

- [ ] **Step 3: Add the tokens to globals.css**

In `app/globals.css`, immediately after line 765 (`--text-display--letter-spacing: -0.02em;`) and before the blank line preceding the `/* Landing-specific @theme registrations …` comment at line 767, insert:

```css

  /* Motion tokens (LUM-284): single source for transition duration and easing.
     duration-* utilities resolve named values from --transition-duration-*;
     ease-* from --ease-* (Tailwind v4 native namespaces).
       duration-fast   hover / color / small state changes
       duration-base   default; popover / dropdown / menus
       duration-slow   collapse-expand / highlight fade / larger moves
       ease-standard   calm decelerate; default for most transitions
       ease-emphasized snappier settle; entering surfaces */
  --transition-duration-fast: 150ms;
  --transition-duration-base: 200ms;
  --transition-duration-slow: 300ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(0.32, 0.72, 0, 1);
```

Note: the comment deliberately contains no `{`, `}`, or the literal `@theme inline` (would break the raw-text styles guards).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd .worktrees/LUM-284-motion-tokens && npx jest __tests__/styles/motion-tokens.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Run the FULL styles suite (globals.css changed)**

Run: `cd .worktrees/LUM-284-motion-tokens && npx jest __tests__/styles/`
Expected: PASS — motion-tokens + globals-css-color-tokens + globals-css-radius-elevation + status-color-tokens + typography-scale-tokens all green. (The other guards parse the same `@theme` block; this confirms the inserted comment didn't break their `[^}]*` / `indexOf('@theme inline')` parsing.)

- [ ] **Step 6: Commit**

```bash
cd .worktrees/LUM-284-motion-tokens
git add app/globals.css __tests__/styles/motion-tokens.test.ts
git commit -m "feat: add motion duration/easing tokens + guard [LUM-284]"
```

---

### Task 2: Migrate scattered `duration-*` utilities in app components

Five files / six sites. Each is a literal class-string swap; existing component tests assert behavior, not the duration class, so they stay green.

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailComments.tsx:113,290`
- Modify: `app/workspace/[workspaceUrl]/components/comments/CommentItem.tsx:64`
- Modify: `app/workspace/[workspaceUrl]/components/comments/ReplyItem.tsx:76`
- Modify: `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx:181`
- Modify: `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx:469`

- [ ] **Step 1: Swap comment-highlight `duration-300` → `duration-slow` (4 sites)**

In each of the four lines below, replace the substring `transition-colors duration-300` with `transition-colors duration-slow` (rest of the line unchanged):

- `TaskDetailComments.tsx:113` — `group flex gap-2.5 rounded-md transition-colors duration-300 …`
- `TaskDetailComments.tsx:290` — `group flex gap-2 rounded-md transition-colors duration-300 …`
- `CommentItem.tsx:64` — `group flex gap-2.5 rounded-md transition-colors duration-300 …`
- `ReplyItem.tsx:76` — `group flex gap-2 rounded-md transition-colors duration-300 …`

- [ ] **Step 2: Swap `duration-150` → `duration-fast` (2 sites)**

- `GlobalDocTree.tsx:181` — replace `transition-all duration-150` with `transition-all duration-fast`.
- `task-columns.tsx:469` — replace `'transition-transform duration-150',` with `'transition-transform duration-fast',`.

- [ ] **Step 3: Confirm no app-code `duration-150`/`duration-300` literals remain**

Run:
```bash
cd .worktrees/LUM-284-motion-tokens
grep -rn "duration-\(150\|300\)\b" --include="*.tsx" "app" | grep -v node_modules
```
Expected: no output. (Vendored `components/ui/*` and `components/landing/*` are intentionally out of scope and live outside `app/`.)

- [ ] **Step 4: Run the affected component tests**

Run:
```bash
cd .worktrees/LUM-284-motion-tokens
npx jest TaskDetailComments CommentItem ReplyItem GlobalDocTree task-columns
```
Expected: PASS (or "no tests found" for any file lacking a test — both acceptable; no failures). Behavior is unchanged, only the duration class name differs.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-284-motion-tokens
git add "app/workspace/[workspaceUrl]/components/TaskDetailComments.tsx" \
        "app/workspace/[workspaceUrl]/components/comments/CommentItem.tsx" \
        "app/workspace/[workspaceUrl]/components/comments/ReplyItem.tsx" \
        "app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx" \
        "app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx"
git commit -m "refactor: migrate app duration utilities to motion tokens [LUM-284]"
```

---

### Task 3: Migrate hardcoded transitions in globals.css

Four app editor/doc selectors with literal `0.12s/0.15s/0.3s` + bare `ease`/`ease-in-out`. Replace with the CSS-var form (raw CSS reads `var(--transition-duration-*)` / `var(--ease-standard)` directly — valid because the tokens are declared in `:root` via `@theme`).

**Files:**
- Modify: `app/globals.css` lines 60, 244, 1090, 1127

- [ ] **Step 1: `.code-block-language-select` (line 60)**

Replace:
```css
  transition: opacity 0.12s ease-in-out;
```
with:
```css
  transition: opacity var(--transition-duration-fast) var(--ease-standard);
```

- [ ] **Step 2: `.toggle-chevron` (line 244)**

Replace:
```css
  transition: transform 0.15s ease;
```
with:
```css
  transition: transform var(--transition-duration-fast) var(--ease-standard);
```

- [ ] **Step 3: `.toc-scroll::-webkit-scrollbar-thumb` (line 1090)**

Replace:
```css
  transition: background 0.3s ease;
```
with:
```css
  transition: background var(--transition-duration-slow) var(--ease-standard);
```

- [ ] **Step 4: `.comment-highlight--active` (line 1127)**

Replace:
```css
  transition: background-color 0.3s ease;
```
with:
```css
  transition: background-color var(--transition-duration-slow) var(--ease-standard);
```

- [ ] **Step 5: Confirm no in-scope hardcoded transition durations remain**

Run:
```bash
cd .worktrees/LUM-284-motion-tokens
grep -n "transition:.*0\.\(12\|15\|3\)s" app/globals.css
```
Expected: no output for the four migrated selectors. (Lines under the landing section — `--animate-appear`, `animation: … 0.6s/0.8s/2s/12s` keyframe shorthands — are animations, not in scope, and won't match this `transition:` pattern.)

- [ ] **Step 6: Run the FULL styles suite again (globals.css changed)**

Run: `cd .worktrees/LUM-284-motion-tokens && npx jest __tests__/styles/`
Expected: PASS — all five guard files green.

- [ ] **Step 7: Commit**

```bash
cd .worktrees/LUM-284-motion-tokens
git add app/globals.css
git commit -m "refactor: migrate globals.css hardcoded transitions to motion tokens [LUM-284]"
```

---

### Task 4: Full verification + open PR

**Files:** none (verification only).

- [ ] **Step 1: Regenerate Prisma client + typecheck (atomic, at the end)**

Run:
```bash
cd .worktrees/LUM-284-motion-tokens
npx prisma generate
npx tsc --noEmit
```
Expected: no errors. (If tsc reports "X not exported" on Prisma types, that's the shared-client clobber from a parallel worktree — re-run `npx prisma generate` here, then `tsc` again.)

- [ ] **Step 2: token-lint (no new raw colors introduced)**

Run: `cd .worktrees/LUM-284-motion-tokens && npm run lint:tokens`
Expected: PASS (this task touches only duration/easing, no color classes — baseline unchanged).

- [ ] **Step 3: Confirm no stray migration deletions in the diff**

Run:
```bash
cd .worktrees/LUM-284-motion-tokens
git fetch origin main --quiet
git diff --name-status origin/main...HEAD
```
Expected: only `docs/superpowers/specs/2026-06-06-motion-tokens-design.md`, `docs/superpowers/plans/2026-06-06-motion-tokens.md`, `app/globals.css`, the five component files, and `__tests__/styles/motion-tokens.test.ts`. No `prisma/migrations/` deletions. If a migration shows as deleted, `git merge origin/main` first (stale-base artifact).

- [ ] **Step 4: Open the PR**

```bash
cd .worktrees/LUM-284-motion-tokens
git push -u origin lumo/LUM-284-motion-tokens
gh pr create --title "feat: motion duration/easing tokens + converge scattered durations [LUM-284]" \
  --body "$(cat <<'EOF'
## What
- Add `--transition-duration-fast/base/slow` (150/200/300ms) and `--ease-standard/emphasized` to the `@theme inline` block in `app/globals.css` — Tailwind v4 native namespaces, emitting `duration-fast/base/slow` + `ease-standard/emphasized` utilities.
- Migrate app-code scattered durations: comment highlight `duration-300 → duration-slow` (×4), GlobalDocTree + task-columns `duration-150 → duration-fast` (×2).
- Migrate four hardcoded `globals.css` transitions (code-block lang select, toggle chevron, TOC scrollbar, comment highlight) to `var(--transition-duration-*)` / `var(--ease-standard)`.
- Add `__tests__/styles/motion-tokens.test.ts` guard.

## Scope
App business code only. `components/ui/*` (vendored shadcn) and `components/landing/*` left untouched, consistent with the LUM-264 color-migration exception policy.

## Verification
- `npx jest __tests__/styles/` — full styles suite green.
- Affected component tests green.
- `npx tsc --noEmit`, `npm run lint:tokens` clean.

No schema changes; no production migration needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR URL printed.

- [ ] **Step 5: Update Lumo task status**

Run: `lumo task update LUM-284 --status in_review`
Expected: status set to IN_REVIEW (done only after the PR lands on origin/main).

---

## Notes for the implementer

- **Visual parity:** fast/base/slow equal the prior 150/200/300ms exactly. Easing shifts from bare `ease`/`ease-in-out` to `ease-standard` (`cubic-bezier(0.2,0,0,1)`) — a calm decelerate, near-identical feel, not pixel-identical. `ease-emphasized` is registered for future entering-surface use but no current app site adopts it (declared, not yet consumed — intentional, per spec).
- **Do not** touch `components/ui/*` or `components/landing/*`.
- **Do not** `prisma migrate reset` or `git checkout`/`switch`/`reset` in this worktree.
