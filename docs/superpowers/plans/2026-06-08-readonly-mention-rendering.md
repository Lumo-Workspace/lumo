# Read-Only Mention Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `RichTextViewer` (read-only) render stored mention HTML as the same chips the editor shows — entity chips clickable, user chips highlighted — by teaching the shared `MentionWithType` node to parse its own serialized DOM and letting `getBaseExtensions()` own a single mention node.

**Architecture:** Three small changes. (1) Add a `parseHTML` override to `MentionWithType` so it claims `a.mention` / `span.mention` (its own `renderHTML` output) — this is the real fix; without it stored mentions degrade to plain text even with the node mounted. (2) Add an `addProseMirrorPlugins` guard so the node only activates a suggestion plugin when a real suggestion (with `render`) is configured — making the node safe to include unconditionally. (3) Parameterize `getBaseExtensions(opts?)` to always include exactly one mention node, attaching the suggestion only when the caller passes one. `RichTextViewer` needs no code change (gets the bare node via `getBaseExtensions()`); `DescriptionEditor` switches to the parameterized form and drops its now-duplicate inline mention registration.

**Tech Stack:** TypeScript, tiptap (`@tiptap/core`, `@tiptap/extension-mention`, `@tiptap/suggestion`), Jest + jsdom + @testing-library/react.

**Working directory:** All work happens in the isolated worktree `.worktrees/LUM-332` on branch `lumo/LUM-332-readonly-mention-rendering` (the main checkout is held by a parallel session). Run all `git` commands with `git -C .worktrees/LUM-332 …` or from inside the worktree. `node_modules` is symlinked to the main checkout — **do NOT run `prisma generate`** (no schema change; it would clobber the shared client).

---

## File Structure

- **Modify** `lib/editor/nodes/mention-with-type.ts` — add `parseHTML` + `addProseMirrorPlugins` to the `MentionWithType` extension. Single responsibility: define the mention node (attrs + parse + render + conditional suggestion plugin).
- **Modify** `lib/editor/extensions.ts` — `getBaseExtensions` gains an optional `opts` param and always appends the mention node (with or without suggestion). Single responsibility: assemble the shared extension base.
- **Modify** `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` — pass the suggestion through `getBaseExtensions(opts)`; remove the inline `MentionWithType.configure(...)` block and the now-unused import.
- **No change** `app/workspace/[workspaceUrl]/components/RichTextViewer.tsx` — already calls `getBaseExtensions()`; gains chips for free.
- **Modify (tests)** `__tests__/lib/editor/mention-with-type.test.ts` — add parseHTML round-trip + suggestion-guard tests.
- **Create (tests)** `__tests__/lib/editor/extensions.test.ts` — assert exactly one mention node, with and without a suggestion.
- **Modify (tests)** `__tests__/components/RichTextViewer.test.tsx` — assert stored mention HTML renders as chips.

---

## Task 1: `parseHTML` override — round-trip stored mention HTML

**Files:**
- Test: `__tests__/lib/editor/mention-with-type.test.ts` (append)
- Modify: `lib/editor/nodes/mention-with-type.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/editor/mention-with-type.test.ts`. Add these imports at the top of the file (below the existing import block):

```ts
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Link from '@tiptap/extension-link'
```

Then append this describe block at the end of the file:

```ts
describe('MentionWithType parseHTML round-trip', () => {
  const userHTML =
    '<p><span class="mention mention-user" data-id="user_a" data-label="Alice" data-mention-type="user">@Alice</span></p>'
  const taskHTML =
    '<p><a class="mention mention-task" data-id="5" data-label="LUM-5" data-mention-type="task" data-mention-title="Fix bug" data-mention-status="IN_PROGRESS" data-href="/x">LUM-5 Fix bug</a></p>'
  const plainLinkHTML = '<p><a href="https://example.com">a normal link</a></p>'

  function mentionNodes(editor: Editor) {
    const nodes: Record<string, unknown>[] = []
    editor.state.doc.descendants(node => {
      if (node.type.name === 'mention') nodes.push(node.attrs)
    })
    return nodes
  }

  it('parses stored entity + user mention HTML back into mention nodes', () => {
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Link.configure({ openOnClick: false }),
        MentionWithType,
      ],
      content: userHTML + taskHTML,
    })
    const nodes = mentionNodes(editor)
    editor.destroy()

    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({ mentionType: 'user', label: 'Alice' })
    expect(nodes[1]).toMatchObject({
      mentionType: 'task',
      mentionHref: '/x',
      mentionStatus: 'IN_PROGRESS',
      mentionTitle: 'Fix bug',
    })
  })

  it('leaves a plain link to the Link mark (does not claim it as a mention)', () => {
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Link.configure({ openOnClick: false }),
        MentionWithType,
      ],
      content: plainLinkHTML,
    })
    const nodes = mentionNodes(editor)
    const html = editor.getHTML()
    editor.destroy()

    expect(nodes).toHaveLength(0)
    expect(html).toContain('href="https://example.com"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/editor/mention-with-type.test.ts -t "round-trip"`
Expected: FAIL — the first test gets `0` mention nodes (stored HTML degrades to plain text) instead of `2`, because the inherited default `parseHTML` only matches `span[data-type="mention"]`.

- [ ] **Step 3: Add the `parseHTML` override**

In `lib/editor/nodes/mention-with-type.ts`, inside the `Mention.extend({ ... })` object, add a `parseHTML` method. Place it immediately before `renderHTML`:

```ts
  parseHTML() {
    // The custom renderHTML below emits `<a class="mention mention-*">` (entities)
    // and `<span class="mention mention-user">` (people) WITHOUT a
    // `data-type="mention"` attribute, so the default Mention parse rule
    // (span[data-type="mention"]) never matches. Claim our own serialized DOM
    // by class instead, so stored content round-trips in both the editor and
    // the read-only viewer.
    return [{ tag: 'a.mention' }, { tag: 'span.mention' }]
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/editor/mention-with-type.test.ts -t "round-trip"`
Expected: PASS (both round-trip tests green).

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/LUM-332 add lib/editor/nodes/mention-with-type.ts __tests__/lib/editor/mention-with-type.test.ts
git -C .worktrees/LUM-332 commit -m "fix: parse stored mention HTML back into mention nodes [LUM-332]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `addProseMirrorPlugins` guard — suggestion only when configured

**Files:**
- Test: `__tests__/lib/editor/mention-with-type.test.ts` (append)
- Modify: `lib/editor/nodes/mention-with-type.ts`

- [ ] **Step 1: Write the failing test**

Append this describe block to `__tests__/lib/editor/mention-with-type.test.ts` (reuses the `Editor`, `Document`, `Paragraph`, `Text` imports added in Task 1):

```ts
describe('MentionWithType suggestion guard', () => {
  function pluginCount(extension: typeof MentionWithType) {
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, extension],
    })
    const n = editor.state.plugins.length
    editor.destroy()
    return n
  }

  it('registers no extra suggestion plugin when no suggestion is configured', () => {
    const bare = pluginCount(MentionWithType)
    const configured = pluginCount(
      MentionWithType.configure({
        suggestion: { char: '@', render: () => ({}) },
      })
    )
    expect(configured).toBeGreaterThan(bare)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/editor/mention-with-type.test.ts -t "suggestion guard"`
Expected: FAIL — without the guard, the inherited `addProseMirrorPlugins` registers a Suggestion plugin even for the bare node, so `bare === configured` and `toBeGreaterThan` fails.

- [ ] **Step 3: Add the `addProseMirrorPlugins` guard**

In `lib/editor/nodes/mention-with-type.ts`, inside the `Mention.extend({ ... })` object, add this method immediately before `parseHTML` (added in Task 1):

```ts
  addProseMirrorPlugins() {
    // Only attach the suggestion plugin when a real suggestion (one with a
    // render handler) is configured. The default Mention suggestion has no
    // render, so a bare node — used by the read-only viewer and by editors
    // that don't pass mentionSources — stays a pure render/parse node and
    // never fires tiptap's default '@' suggestion.
    if (!this.options.suggestion?.render) return []
    return this.parent?.() ?? []
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/editor/mention-with-type.test.ts`
Expected: PASS (all blocks: pure-function, round-trip, suggestion-guard).

- [ ] **Step 5: Typecheck the node file**

Run: `npx tsc --noEmit`
Expected: no errors. If `this.options.suggestion?.render` reports a type error (suggestion typed too narrowly), narrow with `(this.options.suggestion as { render?: unknown } | undefined)?.render` — but try the plain form first.

- [ ] **Step 6: Commit**

```bash
git -C .worktrees/LUM-332 add lib/editor/nodes/mention-with-type.ts __tests__/lib/editor/mention-with-type.test.ts
git -C .worktrees/LUM-332 commit -m "feat: gate mention suggestion plugin on a configured suggestion [LUM-332]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Parameterize `getBaseExtensions` to own a single mention node

**Files:**
- Test: `__tests__/lib/editor/extensions.test.ts` (create)
- Modify: `lib/editor/extensions.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/editor/extensions.test.ts`:

```ts
/** @jest-environment jsdom */

// getBaseExtensions transitively imports the code-block node view, which pulls
// in react-intl (untranspiled ESM). Stub it, mirroring RichTextViewer.test.tsx.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { getBaseExtensions } from '@/lib/editor/extensions'

function mentionCount(extensions: ReturnType<typeof getBaseExtensions>) {
  return extensions.filter(e => e.name === 'mention').length
}

describe('getBaseExtensions mention node', () => {
  it('includes exactly one mention node with no arguments', () => {
    expect(mentionCount(getBaseExtensions())).toBe(1)
  })

  it('includes exactly one mention node when a suggestion is supplied', () => {
    const extensions = getBaseExtensions({
      mentionSuggestion: { char: '@', render: () => ({}) },
    })
    expect(mentionCount(extensions)).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/editor/extensions.test.ts`
Expected: FAIL — current `getBaseExtensions()` includes no mention node, so `mentionCount` is `0`, not `1`. (The second test also fails to typecheck/run because `getBaseExtensions` takes no args yet — that's expected; Step 3 fixes both.)

- [ ] **Step 3: Parameterize `getBaseExtensions`**

In `lib/editor/extensions.ts`:

(a) Add these imports near the other imports (after the existing `import type { Extensions } from '@tiptap/core'` line):

```ts
import type { SuggestionOptions } from '@tiptap/suggestion'
import { MentionWithType } from './nodes/mention-with-type'
```

(b) Change the function signature and append the mention node. Replace:

```ts
export function getBaseExtensions(): Extensions {
  return [
```

with:

```ts
export function getBaseExtensions(opts?: {
  mentionSuggestion?: Partial<SuggestionOptions>
}): Extensions {
  return [
```

(c) Add the mention node as the last array entry, immediately after `CharacterCount,` (and its trailing comment) and before the closing `]`:

```ts
    // Single mention node for the whole base. The read-only viewer gets the
    // bare node (parse + render only); editors pass a suggestion to enable the
    // '@' dropdown. Always exactly one 'mention' node — never registered twice.
    opts?.mentionSuggestion
      ? MentionWithType.configure({ suggestion: opts.mentionSuggestion })
      : MentionWithType,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/editor/extensions.test.ts`
Expected: PASS (both cases → exactly one mention node).

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/LUM-332 add lib/editor/extensions.ts __tests__/lib/editor/extensions.test.ts
git -C .worktrees/LUM-332 commit -m "feat: getBaseExtensions owns a single parameterized mention node [LUM-332]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Switch `DescriptionEditor` to the parameterized base (avoid double registration)

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`

> Why this is required: after Task 3, `...getBaseExtensions()` already brings in a mention node. The existing inline `MentionWithType.configure(...)` block would add a SECOND `'mention'` node → tiptap throws "Duplicate extension names" when the editor mounts. This task moves the suggestion into the base call and removes the inline block.

- [ ] **Step 1: Verify the current behavior baseline (existing tests pass before the change)**

Run: `npx jest __tests__/components/DescriptionEditorOnReady.test.tsx __tests__/components/MentionList.test.tsx __tests__/components/mention-suggestion.test.ts`
Expected: PASS (records the green baseline we must preserve).

- [ ] **Step 2: Replace the base call + remove the inline mention block**

In `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`, find the `extensions:` array inside `useEditor({ ... })`. Replace this exact text:

```ts
    extensions: [
      ...getBaseExtensions(),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      SlashCommandExtension.configure({
        suggestion: buildSlashCommandSuggestion(
          state => setSlashPopup(state),
          state => setSlashPopup(state),
          () => setSlashPopup(null),
          slashListRef,
          id => intl.formatMessage({ id })
        ),
      }),
      ...(mentionSources
        ? [
            MentionWithType.configure({
              suggestion: buildMentionSuggestion(
                mentionSources,
                setMentionPopup,
                setMentionPopup,
                () => setMentionPopup(null),
                mentionListRef
              ),
            }),
          ]
        : []),
```

with:

```ts
    extensions: [
      ...getBaseExtensions(
        mentionSources
          ? {
              mentionSuggestion: buildMentionSuggestion(
                mentionSources,
                setMentionPopup,
                setMentionPopup,
                () => setMentionPopup(null),
                mentionListRef
              ),
            }
          : undefined
      ),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      SlashCommandExtension.configure({
        suggestion: buildSlashCommandSuggestion(
          state => setSlashPopup(state),
          state => setSlashPopup(state),
          () => setSlashPopup(null),
          slashListRef,
          id => intl.formatMessage({ id })
        ),
      }),
```

- [ ] **Step 3: Remove the now-unused import**

In the same file, delete this import line (line ~30):

```ts
import { MentionWithType } from '@/lib/editor/nodes/mention-with-type'
```

Leave `import { buildMentionSuggestion } from './mention-suggestion'` in place — it is still used.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If tsc reports `MentionWithType` is unused, Step 3 wasn't applied; if it reports it's undefined, the inline block in Step 2 wasn't fully removed.)

- [ ] **Step 5: Run the editor's tests to confirm no regression**

Run: `npx jest __tests__/components/DescriptionEditorOnReady.test.tsx __tests__/components/MentionList.test.tsx __tests__/components/mention-suggestion.test.ts`
Expected: PASS (same as the Step 1 baseline — the '@' dropdown still wires up).

- [ ] **Step 6: Commit**

```bash
git -C .worktrees/LUM-332 add "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
git -C .worktrees/LUM-332 commit -m "refactor: wire mention suggestion through getBaseExtensions in DescriptionEditor [LUM-332]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `RichTextViewer` renders mentions as chips (the user-visible outcome)

**Files:**
- Test: `__tests__/components/RichTextViewer.test.tsx` (append)
- No production change (RichTextViewer already calls `getBaseExtensions()`).

- [ ] **Step 1: Write the test**

Append this `it` block inside the existing `describe('RichTextViewer', ...)` in `__tests__/components/RichTextViewer.test.tsx` (the `react-intl` mock and the `render`/`screen` imports already exist at the top):

```ts
  it('renders stored mention HTML as chips, not plain links/text', () => {
    const html =
      '<p>' +
      '<span class="mention mention-user" data-id="u1" data-label="Alice" data-mention-type="user">@Alice</span> ' +
      '<a class="mention mention-task" data-id="5" data-label="LUM-5" data-mention-type="task" data-mention-title="Fix bug" data-mention-status="IN_PROGRESS" data-href="/t/5">LUM-5 Fix bug</a> ' +
      '<a href="https://example.com">normal link</a>' +
      '</p>'
    const { container } = render(<RichTextViewer value={html} />)

    // Entity mention -> clickable chip anchor with the kind class + href + status.
    const taskChip = container.querySelector('a.mention.mention-task')
    expect(taskChip).not.toBeNull()
    expect(taskChip?.getAttribute('data-href')).toBe('/t/5')
    expect(taskChip?.getAttribute('data-mention-status')).toBe('IN_PROGRESS')

    // User mention -> highlighted span chip (not bare text).
    expect(container.querySelector('span.mention.mention-user')).not.toBeNull()

    // A real link is still a plain link, not a mention chip.
    const plain = container.querySelector('a[href="https://example.com"]')
    expect(plain).not.toBeNull()
    expect(plain?.classList.contains('mention')).toBe(false)
  })
```

- [ ] **Step 2: Run the test**

Run: `npx jest __tests__/components/RichTextViewer.test.tsx`
Expected: PASS — because Tasks 1 + 3 make `getBaseExtensions()` parse the stored HTML into mention nodes and render them as chips. (If this fails with the chips absent, Task 1's parseHTML or Task 3's base inclusion is missing.)

- [ ] **Step 3: Commit**

```bash
git -C .worktrees/LUM-332 add __tests__/components/RichTextViewer.test.tsx
git -C .worktrees/LUM-332 commit -m "test: RichTextViewer renders stored mentions as chips [LUM-332]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run all mention/editor tests across both test roots**

Run: `npx jest mention editor RichTextViewer extensions`
Expected: PASS. (Lumo runs two test roots — `__tests__/` and `tests/`. The pattern above is a substring match across both; if any pre-existing mention test lives under `tests/`, it is included.)

- [ ] **Step 3: Grep both roots for any mention test the pattern may have missed**

Run: `grep -rln "mention" __tests__ tests 2>/dev/null`
Then run `npx jest` on any file not already covered by Step 2. Expected: PASS.

- [ ] **Step 4: Confirm no stray console.log / no scratch files**

Run: `git -C .worktrees/LUM-332 status --short` and `grep -rn "console.log" lib/editor/nodes/mention-with-type.ts lib/editor/extensions.ts`
Expected: clean working tree (all changes committed), no `console.log`.

---

## Self-Review (completed during planning)

- **Spec coverage:** parseHTML fix → Task 1; suggestion guard → Task 2; parameterized base → Task 3; DescriptionEditor switch (no double-registration) → Task 4; RichTextViewer chips → Task 5; tsc + jest gate → Task 6. All spec sections mapped.
- **Type consistency:** `getBaseExtensions(opts?: { mentionSuggestion?: Partial<SuggestionOptions> })` — same option name used in Task 3 (definition), Task 4 (DescriptionEditor call), and both extensions/RichTextViewer tests. `MentionWithType` imported into `extensions.ts` (Task 3) and removed from `DescriptionEditor.tsx` (Task 4) — net import location moves, no dangling reference.
- **No placeholders:** every code step shows complete code; every run step shows the command + expected result.
- **Scope:** single PR, three production files + three test files, no schema, no i18n, no new deps.
