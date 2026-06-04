# Callout + Toggle Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two custom Tiptap nodes — a Callout block (emoji + colored highlight, 5 variants) and a Toggle block (collapsible summary + body) — wired into the slash menu and the read-only viewer.

**Architecture:** New nodes live in `lib/editor/nodes/`, registered once in `getBaseExtensions()` so the editable `DescriptionEditor` and read-only `RichTextViewer` share identical rendering via React NodeViews (mirrors the existing `CodeBlock` pattern). Callout stores only a `variant` attribute; the emoji is derived in the NodeView (single source of truth). Toggle persists an `open` attribute so the author's expand/collapse state survives into the viewer. Slash-menu labels are localized by injecting a translate function from `DescriptionEditor` (which already has `useIntl`), keeping the lib layer react-intl-free, matching the existing `SlashCommandList` label-injection pattern.

**Tech Stack:** Tiptap 3.x (`@tiptap/core`, `@tiptap/react`), React, react-intl, shadcn `DropdownMenu` (Radix), Jest + Testing Library, Tailwind/CSS-vars in `app/globals.css`.

**Branch:** `lumo/LUM-221-callout-toggle` (already created off `origin/main`; the design spec is already committed there).

**Reference files to imitate:**

- Custom node + NodeView with dropdown + intl + `editor.isEditable` gating: `lib/editor/nodes/code-block.ts`, `lib/editor/nodes/code-block-view.tsx`
- Pure-function node tests: `__tests__/editor/mention-with-type.test.ts`
- Read-only render test (jsdom + react-intl mock): the existing `RichTextViewer` test
- Editor CSS with theme vars + `.dark` overrides: `app/globals.css:42-114`

---

## Conventions that WILL bite you (read first)

- **`tsc` strictness:** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are ON. `arr[i]` is `T | undefined` even after a length check. Optional fields that may hold `undefined` must be typed `field?: T | undefined`. Jest (SWC) does **not** catch these — only `npx tsc --noEmit` does. Always run `tsc` before claiming done.
- **i18n:** every new user-facing string needs a key in **all 16** locale files in `lib/i18n/` (`de, en, en-AU, en-GB, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW`). Keys are a **flat** JSON map (e.g. `"editor.codeBlock": "Code block"`). No English fallback for non-English locales.
- **token-lint:** do not put raw Tailwind palette classes (`bg-zinc-100`, `text-gray-500`, …) in the new `.tsx` files — use semantic classes (`bg-muted`, `text-muted-foreground`, `text-foreground`, `border`). Variant colors go in `app/globals.css` as real CSS (hex + `.dark` overrides), which is how the existing `hljs` theme already does it — that is fine.
- **Run jest from the repo root** (`/Users/chaoli/Desktop/lumo/lumo`). If working in a worktree, `cd` into it first (a haste/package.json collision otherwise silently runs the wrong tests).
- **Radix in jsdom:** Radix `DropdownMenu`/`Select` can't actually open in jsdom (no `hasPointerCapture`). Do **not** write tests that open the dropdown. Cover variant-switching at the pure-config / attribute level. The read-only viewer hides the dropdown anyway.

---

## File Structure

**Create:**

- `lib/editor/nodes/callout-variants.ts` — pure variant config + lookup (emoji, i18n label id, css key). Single responsibility: variant metadata. No Tiptap/React imports.
- `lib/editor/nodes/callout.ts` — Callout Tiptap node (schema, attrs, render/parse, `setCallout` command, NodeView wiring).
- `lib/editor/nodes/callout-node-view.tsx` — Callout React NodeView (emoji button → variant dropdown when editable; plain emoji when read-only; body content hole).
- `lib/editor/nodes/toggle.ts` — Toggle/ToggleSummary/ToggleContent Tiptap nodes + `setToggle` command + NodeView wiring.
- `lib/editor/nodes/toggle-node-view.tsx` — Toggle React NodeView (chevron toggles `open`; summary + content holes).
- `__tests__/editor/callout-variants.test.ts` — unit tests for the variant config.
- `__tests__/editor/callout.test.ts` — unit tests for Callout node attrs/render/parse helpers + slash presence.
- `__tests__/editor/toggle.test.ts` — unit tests for Toggle node attrs/render/parse helpers.
- `__tests__/editor/slash-command.test.ts` — unit test that the new slash items exist.
- `__tests__/components/CalloutToggleViewer.test.tsx` — jsdom test: `RichTextViewer` renders stored Callout + Toggle HTML.

**Modify:**

- `lib/editor/extensions.ts` — import & register the new nodes.
- `lib/editor/slash-command.tsx` — accept a translate fn; add `/callout` and `/toggle` items.
- `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx:182-187` — pass the translate fn into `buildSlashCommandSuggestion`.
- `lib/i18n/*.json` (16 files) — add the new keys.
- `app/globals.css` — Callout variant styles + Toggle styles.

---

## Task 1: Callout variant config (pure)

**Files:**

- Create: `lib/editor/nodes/callout-variants.ts`
- Test: `__tests__/editor/callout-variants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/editor/callout-variants.test.ts
import {
  CALLOUT_VARIANTS,
  CALLOUT_VARIANT_KEYS,
  getCalloutVariant,
  isCalloutVariantKey,
} from '@/lib/editor/nodes/callout-variants'

describe('callout variants config', () => {
  it('defines exactly the five agreed variants in order', () => {
    expect(CALLOUT_VARIANT_KEYS).toEqual([
      'info',
      'warning',
      'success',
      'note',
      'error',
    ])
  })

  it('maps each variant to an emoji and an i18n label id', () => {
    expect(getCalloutVariant('warning')).toEqual({
      key: 'warning',
      emoji: '⚠️',
      labelId: 'editor.callout.variant.warning',
    })
    expect(getCalloutVariant('info').emoji).toBe('💡')
    expect(getCalloutVariant('success').emoji).toBe('✅')
    expect(getCalloutVariant('note').emoji).toBe('📝')
    expect(getCalloutVariant('error').emoji).toBe('❌')
  })

  it('falls back to "info" for unknown / undefined values', () => {
    expect(getCalloutVariant('bogus').key).toBe('info')
    expect(getCalloutVariant(undefined).key).toBe('info')
    expect(getCalloutVariant(null).key).toBe('info')
  })

  it('isCalloutVariantKey guards correctly', () => {
    expect(isCalloutVariantKey('error')).toBe(true)
    expect(isCalloutVariantKey('nope')).toBe(false)
    expect(isCalloutVariantKey(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/editor/callout-variants.test.ts`
Expected: FAIL — "Cannot find module '@/lib/editor/nodes/callout-variants'".

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/editor/nodes/callout-variants.ts

/** The five Callout variants, in menu order. */
export const CALLOUT_VARIANT_KEYS = [
  'info',
  'warning',
  'success',
  'note',
  'error',
] as const

export type CalloutVariantKey = (typeof CALLOUT_VARIANT_KEYS)[number]

export interface CalloutVariant {
  key: CalloutVariantKey
  /** Fixed emoji shown in the gutter; derived from the variant, never stored. */
  emoji: string
  /** react-intl message id for the dropdown label. */
  labelId: string
}

const VARIANTS: Record<CalloutVariantKey, CalloutVariant> = {
  info: { key: 'info', emoji: '💡', labelId: 'editor.callout.variant.info' },
  warning: {
    key: 'warning',
    emoji: '⚠️',
    labelId: 'editor.callout.variant.warning',
  },
  success: {
    key: 'success',
    emoji: '✅',
    labelId: 'editor.callout.variant.success',
  },
  note: { key: 'note', emoji: '📝', labelId: 'editor.callout.variant.note' },
  error: { key: 'error', emoji: '❌', labelId: 'editor.callout.variant.error' },
}

/** Ordered list for rendering the dropdown / iterating variants. */
export const CALLOUT_VARIANTS: readonly CalloutVariant[] =
  CALLOUT_VARIANT_KEYS.map(k => VARIANTS[k])

export const DEFAULT_CALLOUT_VARIANT: CalloutVariantKey = 'info'

export function isCalloutVariantKey(
  value: unknown
): value is CalloutVariantKey {
  return (
    typeof value === 'string' &&
    (CALLOUT_VARIANT_KEYS as readonly string[]).includes(value)
  )
}

/** Resolve any attribute value to a known variant, defaulting to "info". */
export function getCalloutVariant(value: unknown): CalloutVariant {
  return isCalloutVariantKey(value)
    ? VARIANTS[value]
    : VARIANTS[DEFAULT_CALLOUT_VARIANT]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/editor/callout-variants.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/nodes/callout-variants.ts __tests__/editor/callout-variants.test.ts
git commit -m "feat: callout variant config [LUM-221]"
```

---

## Task 2: Callout node

**Files:**

- Create: `lib/editor/nodes/callout.ts`
- Test: `__tests__/editor/callout.test.ts`

This task creates the node and wires it to a NodeView that does not exist yet. To keep tests green and the build importable, Task 3 creates the NodeView. Within this task we import the NodeView component eagerly; create it as a stub at the START of step 3 if needed, then flesh it out in Task 3. (Simplest: do Task 2 and Task 3 back-to-back; the stub keeps the file compiling.)

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/editor/callout.test.ts
import {
  Callout,
  calloutAttributesForVariant,
} from '@/lib/editor/nodes/callout'

describe('Callout node', () => {
  it('is a Tiptap node named "callout"', () => {
    expect(Callout.name).toBe('callout')
  })

  it('renders the variant as a data-variant attribute (no emoji in HTML)', () => {
    expect(calloutAttributesForVariant('warning')).toEqual({
      'data-variant': 'warning',
    })
  })

  it('normalizes unknown variants to info on render', () => {
    expect(calloutAttributesForVariant('bogus')).toEqual({
      'data-variant': 'info',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/editor/callout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

First, create a NodeView stub so the import resolves (Task 3 replaces the body):

```tsx
// lib/editor/nodes/callout-node-view.tsx  (STUB — fleshed out in Task 3)
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

export function CalloutNodeView() {
  return (
    <NodeViewWrapper>
      <NodeViewContent />
    </NodeViewWrapper>
  )
}
```

Then the node:

```ts
// lib/editor/nodes/callout.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import {
  getCalloutVariant,
  DEFAULT_CALLOUT_VARIANT,
  type CalloutVariantKey,
} from './callout-variants'
import { CalloutNodeView } from './callout-node-view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Insert an empty callout of the given variant (default: info). */
      setCallout: (attrs?: { variant?: CalloutVariantKey }) => ReturnType
    }
  }
}

/**
 * Pure helper (testable without an Editor): the DOM attributes a callout
 * with the given variant serializes to. Emoji is NEVER serialized — it is
 * derived from `variant` in {@link CalloutNodeView}, the single source of truth.
 */
export function calloutAttributesForVariant(value: unknown): {
  'data-variant': CalloutVariantKey
} {
  return { 'data-variant': getCalloutVariant(value).key }
}

/**
 * Callout block: emoji + colored highlight. Holds arbitrary block content.
 * Same NodeView runs in the editor and the read-only viewer (registered via
 * getBaseExtensions); the variant dropdown is gated on editor.isEditable.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: DEFAULT_CALLOUT_VARIANT,
        parseHTML: el => getCalloutVariant(el.getAttribute('data-variant')).key,
        renderHTML: attrs => calloutAttributesForVariant(attrs.variant),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView)
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { variant: attrs.variant ?? DEFAULT_CALLOUT_VARIANT },
            content: [{ type: 'paragraph' }],
          }),
    }
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/editor/callout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/nodes/callout.ts lib/editor/nodes/callout-node-view.tsx __tests__/editor/callout.test.ts
git commit -m "feat: callout node + serialization [LUM-221]"
```

---

## Task 3: Callout NodeView (emoji + variant dropdown)

**Files:**

- Modify: `lib/editor/nodes/callout-node-view.tsx` (replace the Task-2 stub)

No new unit test (Radix dropdown can't open in jsdom). Behavior is covered end-to-end by the viewer test in Task 10 and by manual run in Task 11.

- [ ] **Step 1: Replace the stub with the full NodeView**

```tsx
// lib/editor/nodes/callout-node-view.tsx
import { useIntl } from 'react-intl'
import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from '@tiptap/react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { CALLOUT_VARIANTS, getCalloutVariant } from './callout-variants'

/**
 * React node view for the Callout block. The gutter emoji is derived from the
 * `variant` attribute (never stored as text). While the editor is editable the
 * emoji is a dropdown trigger for switching variant; in the read-only
 * RichTextViewer it renders as a plain, non-interactive emoji.
 */
export function CalloutNodeView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const intl = useIntl()
  const variant = getCalloutVariant(node.attrs.variant)

  return (
    <NodeViewWrapper
      className='callout'
      data-callout=''
      data-variant={variant.key}
    >
      {editor.isEditable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='callout-icon callout-icon-button'
              contentEditable={false}
              aria-label={intl.formatMessage({
                id: 'editor.callout.changeType',
                defaultMessage: 'Change callout type',
              })}
              // Keep ProseMirror from treating the control as editable content.
              onMouseDown={event => event.preventDefault()}
            >
              {variant.emoji}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            {CALLOUT_VARIANTS.map(v => (
              <DropdownMenuItem
                key={v.key}
                onSelect={() => updateAttributes({ variant: v.key })}
              >
                <span className='mr-2' aria-hidden>
                  {v.emoji}
                </span>
                {intl.formatMessage({ id: v.labelId })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className='callout-icon' contentEditable={false} aria-hidden>
          {variant.emoji}
        </span>
      )}
      <NodeViewContent className='callout-body' />
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from these files.

- [ ] **Step 3: Re-run callout tests (still green)**

Run: `npx jest __tests__/editor/callout-variants.test.ts __tests__/editor/callout.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/editor/nodes/callout-node-view.tsx
git commit -m "feat: callout node view with variant dropdown [LUM-221]"
```

---

## Task 4: Toggle nodes (toggle / summary / content)

**Files:**

- Create: `lib/editor/nodes/toggle.ts`
- Test: `__tests__/editor/toggle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/editor/toggle.test.ts
import {
  Toggle,
  ToggleSummary,
  ToggleContent,
  ToggleExtensions,
  parseToggleOpen,
  renderToggleOpenAttr,
} from '@/lib/editor/nodes/toggle'

describe('Toggle nodes', () => {
  it('exposes three nodes with the expected names', () => {
    expect(Toggle.name).toBe('toggle')
    expect(ToggleSummary.name).toBe('toggleSummary')
    expect(ToggleContent.name).toBe('toggleContent')
  })

  it('bundles all three for registration', () => {
    expect(ToggleExtensions).toEqual([Toggle, ToggleSummary, ToggleContent])
  })

  it('parses data-open: only the string "false" is collapsed', () => {
    expect(parseToggleOpen('true')).toBe(true)
    expect(parseToggleOpen('false')).toBe(false)
    expect(parseToggleOpen(null)).toBe(true) // default open
  })

  it('renders the open attr round-trippably', () => {
    expect(renderToggleOpenAttr(true)).toEqual({ 'data-open': 'true' })
    expect(renderToggleOpenAttr(false)).toEqual({ 'data-open': 'false' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/editor/toggle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create a NodeView stub first so the import resolves (Task 5 replaces it):

```tsx
// lib/editor/nodes/toggle-node-view.tsx  (STUB — fleshed out in Task 5)
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

export function ToggleNodeView() {
  return (
    <NodeViewWrapper>
      <NodeViewContent />
    </NodeViewWrapper>
  )
}
```

Then the nodes:

```ts
// lib/editor/nodes/toggle.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ToggleNodeView } from './toggle-node-view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Insert a collapsible toggle (open by default) with an empty body. */
      setToggle: () => ReturnType
    }
  }
}

/** Pure: parse the persisted `data-open` attribute. Only "false" collapses. */
export function parseToggleOpen(value: string | null): boolean {
  return value !== 'false'
}

/** Pure: serialize the `open` attribute. */
export function renderToggleOpenAttr(open: boolean): { 'data-open': string } {
  return { 'data-open': open ? 'true' : 'false' }
}

/** Title row of a toggle — inline rich text (bold, mentions, inline code). */
export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-toggle-summary]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-toggle-summary': '' }),
      0,
    ]
  },
})

/** Collapsible body of a toggle — arbitrary block content. */
export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-toggle-content]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-toggle-content': '' }),
      0,
    ]
  },
})

/** Toggle wrapper: a summary followed by a collapsible content block. */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: el => parseToggleOpen(el.getAttribute('data-open')),
        renderHTML: attrs => renderToggleOpenAttr(Boolean(attrs.open)),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView)
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              { type: 'toggleSummary' },
              { type: 'toggleContent', content: [{ type: 'paragraph' }] },
            ],
          }),
    }
  },
})

/** All three nodes, ready to spread into getBaseExtensions(). */
export const ToggleExtensions = [Toggle, ToggleSummary, ToggleContent]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/editor/toggle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/nodes/toggle.ts lib/editor/nodes/toggle-node-view.tsx __tests__/editor/toggle.test.ts
git commit -m "feat: toggle nodes + serialization [LUM-221]"
```

---

## Task 5: Toggle NodeView (chevron + collapse)

**Files:**

- Modify: `lib/editor/nodes/toggle-node-view.tsx` (replace the Task-4 stub)

- [ ] **Step 1: Replace the stub with the full NodeView**

```tsx
// lib/editor/nodes/toggle-node-view.tsx
import { useIntl } from 'react-intl'
import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from '@tiptap/react'

/**
 * React node view for the Toggle block. The chevron flips the persisted `open`
 * attribute; CSS (keyed off data-open) rotates the chevron and hides the
 * content when collapsed. The chevron stays interactive in the read-only
 * RichTextViewer so readers can expand/collapse (the change is local to the
 * viewer's editor state and is never saved).
 */
export function ToggleNodeView({ node, updateAttributes }: NodeViewProps) {
  const intl = useIntl()
  const open = node.attrs.open !== false

  return (
    <NodeViewWrapper
      className='toggle'
      data-toggle=''
      data-open={open ? 'true' : 'false'}
    >
      <button
        type='button'
        className='toggle-chevron'
        contentEditable={false}
        aria-expanded={open}
        aria-label={intl.formatMessage({
          id: 'editor.toggle.toggle',
          defaultMessage: 'Expand or collapse',
        })}
        onClick={() => updateAttributes({ open: !open })}
        onMouseDown={event => event.preventDefault()}
      >
        ▶
      </button>
      <NodeViewContent className='toggle-inner' />
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from these files.

- [ ] **Step 3: Commit**

```bash
git add lib/editor/nodes/toggle-node-view.tsx
git commit -m "feat: toggle node view with collapse [LUM-221]"
```

---

## Task 6: Register both nodes in getBaseExtensions

**Files:**

- Modify: `lib/editor/extensions.ts`

- [ ] **Step 1: Add imports**

After the existing `import { CodeBlock } from './nodes/code-block'` line (currently line 18), add:

```ts
import { Callout } from './nodes/callout'
import { ToggleExtensions } from './nodes/toggle'
```

- [ ] **Step 2: Register in the returned array**

In `getBaseExtensions()`, add the new nodes just before `TaskLink,` (the last entry):

```ts
    Highlight.configure({ multicolor: true }),
    Typography,
    Callout,
    ...ToggleExtensions,
    TaskLink,
  ]
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full editor test suite (nothing regressed)**

Run: `npx jest __tests__/editor`
Expected: PASS (all prior + new editor tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/extensions.ts
git commit -m "feat: register callout + toggle in base extensions [LUM-221]"
```

---

## Task 7: Slash commands for Callout + Toggle (localized)

**Files:**

- Modify: `lib/editor/slash-command.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`
- Test: `__tests__/editor/slash-command.test.ts`

The lib layer stays react-intl-free: `getSlashCommandItems` accepts a translate function `t`, injected by `DescriptionEditor` (which has `useIntl`). Existing items keep their hardcoded English (out of scope per the spec); only the two new items use `t`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/editor/slash-command.test.ts
import { getSlashCommandItems } from '@/lib/editor/slash-command'

describe('getSlashCommandItems', () => {
  // Identity translate fn → titles equal their message ids, easy to assert.
  const items = getSlashCommandItems((id: string) => id)

  it('includes a localized Callout item', () => {
    const callout = items.find(i => i.title === 'editor.slash.callout.title')
    expect(callout).toBeDefined()
    expect(callout?.description).toBe('editor.slash.callout.description')
    expect(typeof callout?.command).toBe('function')
  })

  it('includes a localized Toggle item', () => {
    const toggle = items.find(i => i.title === 'editor.slash.toggle.title')
    expect(toggle).toBeDefined()
    expect(toggle?.description).toBe('editor.slash.toggle.description')
    expect(typeof toggle?.command).toBe('function')
  })

  it('still returns the existing built-in items', () => {
    expect(items.find(i => i.title === 'Text')).toBeDefined()
    expect(items.find(i => i.title === 'Table')).toBeDefined()
  })

  it('works with no translate fn (English fallback for new items)', () => {
    const fallback = getSlashCommandItems()
    expect(fallback.find(i => i.title === 'Callout')).toBeDefined()
    expect(fallback.find(i => i.title === 'Toggle')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/editor/slash-command.test.ts`
Expected: FAIL — `getSlashCommandItems` ignores the arg / no callout item.

- [ ] **Step 3: Implement**

In `lib/editor/slash-command.tsx`:

(a) Add icons to the existing `lucide-react` import (line 5-18): add `Lightbulb` and `ChevronRight`.

```ts
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  ImageIcon,
  Table2,
  Code2,
  Quote,
  Minus,
  Lightbulb,
  ChevronRight,
} from 'lucide-react'
```

(b) Add a translate-fn type above `getSlashCommandItems` (after the `SlashCommandItem` interface):

```ts
/** Localized-string lookup injected from the React layer (keeps this lib file
 *  free of react-intl). Defaults to returning English for the new items. */
export type SlashCommandTranslate = (id: string) => string
```

(c) Change the signature and add the two items. The default `t` returns English so the lib works standalone (tests, safety):

```ts
const FALLBACK_LABELS: Record<string, string> = {
  'editor.slash.callout.title': 'Callout',
  'editor.slash.callout.description': 'Highlighted note block',
  'editor.slash.toggle.title': 'Toggle',
  'editor.slash.toggle.description': 'Collapsible block',
}

export function getSlashCommandItems(
  t: SlashCommandTranslate = id => FALLBACK_LABELS[id] ?? id
): SlashCommandItem[] {
  return [
    // ... ALL existing items unchanged ...
    // Append these two AFTER the existing "Divider" item, still inside the array:
    {
      title: t('editor.slash.callout.title'),
      description: t('editor.slash.callout.description'),
      icon: <Lightbulb size={ICON_SIZE} />,
      category: 'Advanced',
      command: editor => editor.chain().focus().setCallout().run(),
    },
    {
      title: t('editor.slash.toggle.title'),
      description: t('editor.slash.toggle.description'),
      icon: <ChevronRight size={ICON_SIZE} />,
      category: 'Advanced',
      command: editor => editor.chain().focus().setToggle().run(),
    },
  ]
}
```

(d) Thread `t` through `buildSlashCommandSuggestion` — add a 5th param and pass it down:

```ts
export function buildSlashCommandSuggestion(
  onOpen: (state: SlashCommandPopupState) => void,
  onUpdate: (state: SlashCommandPopupState) => void,
  onClose: () => void,
  listRef: React.RefObject<{
    onKeyDown: (props: { event: KeyboardEvent }) => boolean
  } | null>,
  t?: SlashCommandTranslate
): Partial<SuggestionOptions> {
  const allItems = getSlashCommandItems(t)
  // ... rest unchanged ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/editor/slash-command.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the translate fn from DescriptionEditor**

In `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`, update the `buildSlashCommandSuggestion` call (currently lines 182-187) to pass the translate fn. `intl` is already in scope (line 97):

```ts
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

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/editor/slash-command.tsx "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx" __tests__/editor/slash-command.test.ts
git commit -m "feat: callout + toggle slash commands [LUM-221]"
```

---

## Task 8: i18n keys (all 16 locales)

**Files:**

- Modify: `lib/i18n/{de,en,en-AU,en-GB,es,es-419,fr,hi,id,ja,ko,ms,ru,vi,zh-CN,zh-TW}.json`

Add these 11 flat keys to every locale file (place them near the other `editor.*` keys, e.g. after `"editor.codeBlock.plainText"`). Use the per-locale values in the table below. `en`, `en-GB`, `en-AU` share the English column; `es` and `es-419` share the Spanish column.

**Keys (in order):**

1. `editor.slash.callout.title`
2. `editor.slash.callout.description`
3. `editor.slash.toggle.title`
4. `editor.slash.toggle.description`
5. `editor.callout.variant.info`
6. `editor.callout.variant.warning`
7. `editor.callout.variant.success`
8. `editor.callout.variant.note`
9. `editor.callout.variant.error`
10. `editor.callout.changeType`
11. `editor.toggle.toggle`

**Translations:**

| key                       | en / en-GB / en-AU     | zh-CN        | zh-TW          | ja                       | ko                |
| ------------------------- | ---------------------- | ------------ | -------------- | ------------------------ | ----------------- |
| slash.callout.title       | Callout                | 提示块       | 提示區塊       | コールアウト             | 콜아웃            |
| slash.callout.description | Highlighted note block | 高亮提示块   | 高亮提示區塊   | 強調メモブロック         | 강조 메모 블록    |
| slash.toggle.title        | Toggle                 | 折叠块       | 摺疊區塊       | トグル                   | 토글              |
| slash.toggle.description  | Collapsible block      | 可折叠内容块 | 可摺疊內容區塊 | 折りたたみブロック       | 접을 수 있는 블록 |
| variant.info              | Info                   | 提示         | 提示           | 情報                     | 정보              |
| variant.warning           | Warning                | 警告         | 警告           | 警告                     | 경고              |
| variant.success           | Success                | 成功         | 成功           | 成功                     | 성공              |
| variant.note              | Note                   | 笔记         | 筆記           | メモ                     | 메모              |
| variant.error             | Error                  | 错误         | 錯誤           | エラー                   | 오류              |
| callout.changeType        | Change callout type    | 更改提示类型 | 變更提示類型   | コールアウトの種類を変更 | 콜아웃 유형 변경  |
| toggle.toggle             | Expand or collapse     | 展开或折叠   | 展開或摺疊     | 展開または折りたたみ     | 펼치기 또는 접기  |

| key                       | es / es-419              | fr                           | de                         | ru                      |
| ------------------------- | ------------------------ | ---------------------------- | -------------------------- | ----------------------- |
| slash.callout.title       | Llamada                  | Encadré                      | Hinweis                    | Выноска                 |
| slash.callout.description | Bloque de nota destacada | Bloc de note mis en évidence | Hervorgehobener Notizblock | Блок выделенной заметки |
| slash.toggle.title        | Alternar                 | Bascule                      | Umschalten                 | Переключатель           |
| slash.toggle.description  | Bloque plegable          | Bloc repliable               | Einklappbarer Block        | Сворачиваемый блок      |
| variant.info              | Información              | Information                  | Info                       | Информация              |
| variant.warning           | Advertencia              | Avertissement                | Warnung                    | Предупреждение          |
| variant.success           | Éxito                    | Succès                       | Erfolg                     | Успех                   |
| variant.note              | Nota                     | Note                         | Notiz                      | Заметка                 |
| variant.error             | Error                    | Erreur                       | Fehler                     | Ошибка                  |
| callout.changeType        | Cambiar tipo de llamada  | Changer le type d'encadré    | Hinweistyp ändern          | Изменить тип выноски    |
| toggle.toggle             | Expandir o contraer      | Développer ou réduire        | Ein- oder ausklappen       | Развернуть или свернуть |

| key                       | hi                                | id                      | ms                     | vi                      |
| ------------------------- | --------------------------------- | ----------------------- | ---------------------- | ----------------------- |
| slash.callout.title       | कॉलआउट                            | Sorotan                 | Sorotan                | Chú thích               |
| slash.callout.description | हाइलाइट किया गया नोट ब्लॉक        | Blok catatan tersorot   | Blok nota disorot      | Khối ghi chú nổi bật    |
| slash.toggle.title        | टॉगल                              | Lipat                   | Togol                  | Thu gọn                 |
| slash.toggle.description  | संक्षिप्त किया जा सकने वाला ब्लॉक | Blok yang dapat dilipat | Blok boleh lipat       | Khối có thể thu gọn     |
| variant.info              | जानकारी                           | Info                    | Maklumat               | Thông tin               |
| variant.warning           | चेतावनी                           | Peringatan              | Amaran                 | Cảnh báo                |
| variant.success           | सफलता                             | Berhasil                | Berjaya                | Thành công              |
| variant.note              | नोट                               | Catatan                 | Nota                   | Ghi chú                 |
| variant.error             | त्रुटि                            | Kesalahan               | Ralat                  | Lỗi                     |
| callout.changeType        | कॉलआउट प्रकार बदलें               | Ubah tipe sorotan       | Tukar jenis sorotan    | Thay đổi loại chú thích |
| toggle.toggle             | विस्तृत करें या संक्षिप्त करें    | Perluas atau ciutkan    | Kembang atau runtuhkan | Mở rộng hoặc thu gọn    |

Example block to insert into `lib/i18n/en.json` (adapt values per locale):

```json
  "editor.slash.callout.title": "Callout",
  "editor.slash.callout.description": "Highlighted note block",
  "editor.slash.toggle.title": "Toggle",
  "editor.slash.toggle.description": "Collapsible block",
  "editor.callout.variant.info": "Info",
  "editor.callout.variant.warning": "Warning",
  "editor.callout.variant.success": "Success",
  "editor.callout.variant.note": "Note",
  "editor.callout.variant.error": "Error",
  "editor.callout.changeType": "Change callout type",
  "editor.toggle.toggle": "Expand or collapse",
```

- [ ] **Step 1: Add the keys to all 16 files** (respect each file's existing trailing-comma/formatting; prettier runs on commit).

- [ ] **Step 2: Validate every locale is still valid JSON and has all 11 keys**

Run:

```bash
node -e "const fs=require('fs');const ks=['editor.slash.callout.title','editor.slash.callout.description','editor.slash.toggle.title','editor.slash.toggle.description','editor.callout.variant.info','editor.callout.variant.warning','editor.callout.variant.success','editor.callout.variant.note','editor.callout.variant.error','editor.callout.changeType','editor.toggle.toggle'];for(const f of fs.readdirSync('lib/i18n').filter(f=>f.endsWith('.json'))){const j=JSON.parse(fs.readFileSync('lib/i18n/'+f,'utf8'));const miss=ks.filter(k=>!(k in j));if(miss.length)throw new Error(f+' missing: '+miss.join(', '));}console.log('all 16 locales OK')"
```

Expected: `all 16 locales OK`.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n
git commit -m "i18n: callout + toggle strings (16 locales) [LUM-221]"
```

---

## Task 9: Styles (Callout variants + Toggle)

**Files:**

- Modify: `app/globals.css`

Append to the editor section of `app/globals.css` (after the `hljs` theme block, before unrelated sections). Uses theme CSS vars for structure + hex accent tints with `.dark` overrides — same approach as the existing `hljs` theme.

- [ ] **Step 1: Add the CSS**

```css
/* ── Callout block (CalloutNodeView) ───────────────────────────── */
.callout {
  display: flex;
  gap: 0.625rem;
  margin: 0.5rem 0;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 0.5rem;
  background-color: var(--muted);
}
.callout-icon {
  flex: none;
  font-size: 1rem;
  line-height: 1.5;
  user-select: none;
}
.callout-icon-button {
  cursor: pointer;
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: 0.25rem;
}
.callout-icon-button:hover {
  background-color: rgba(0, 0, 0, 0.06);
}
.dark .callout-icon-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
.callout-body {
  flex: 1;
  min-width: 0;
}
.callout-body > :first-child {
  margin-top: 0;
}
.callout-body > :last-child {
  margin-bottom: 0;
}

/* Variant accent tints (light). */
.callout[data-variant='info'] {
  background-color: #eff6ff;
  border-color: #dbeafe;
  border-left-color: #3b82f6;
}
.callout[data-variant='warning'] {
  background-color: #fffbeb;
  border-color: #fde68a;
  border-left-color: #f59e0b;
}
.callout[data-variant='success'] {
  background-color: #f0fdf4;
  border-color: #bbf7d0;
  border-left-color: #22c55e;
}
.callout[data-variant='note'] {
  background-color: var(--muted);
  border-color: var(--border);
  border-left-color: var(--muted-foreground);
}
.callout[data-variant='error'] {
  background-color: #fef2f2;
  border-color: #fecaca;
  border-left-color: #ef4444;
}
/* Variant accent tints (dark) — translucent so they read on dark bg. */
.dark .callout[data-variant='info'] {
  background-color: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.35);
  border-left-color: #60a5fa;
}
.dark .callout[data-variant='warning'] {
  background-color: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.35);
  border-left-color: #fbbf24;
}
.dark .callout[data-variant='success'] {
  background-color: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.35);
  border-left-color: #4ade80;
}
.dark .callout[data-variant='error'] {
  background-color: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
  border-left-color: #f87171;
}

/* ── Toggle block (ToggleNodeView) ─────────────────────────────── */
.toggle {
  position: relative;
  margin: 0.25rem 0;
  padding-left: 1.25rem;
}
.toggle-chevron {
  position: absolute;
  left: 0;
  top: 0.15rem;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 0.7rem;
  color: var(--muted-foreground);
  border-radius: 0.25rem;
  transition: transform 0.15s ease;
}
.toggle-chevron:hover {
  color: var(--foreground);
}
.toggle[data-open='true'] .toggle-chevron {
  transform: rotate(90deg);
}
.toggle [data-toggle-summary] {
  font-weight: 600;
}
.toggle [data-toggle-content] {
  margin-top: 0.25rem;
  padding-left: 0.5rem;
  border-left: 2px solid var(--border);
}
.toggle[data-open='false'] [data-toggle-content] {
  display: none;
}
```

- [ ] **Step 2: Verify CSS is valid (build does not error) and token-lint passes**

Run: `npm run lint:tokens`
Expected: PASS (no new violations — variant colors live in CSS, not Tailwind classes).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: callout variant + toggle styles [LUM-221]"
```

---

## Task 10: Read-only viewer integration test

**Files:**

- Test: `__tests__/components/CalloutToggleViewer.test.tsx`

Proves the full renderHTML↔parseHTML round-trip and read-only rendering: stored HTML → `RichTextViewer` → visible content + correct data attributes + derived emoji. The dropdown is hidden in read-only, so no Radix-open issue.

- [ ] **Step 1: Write the test**

```tsx
// __tests__/components/CalloutToggleViewer.test.tsx
/** @jest-environment jsdom */

// NodeViews import react-intl (untranspiled ESM); stub it. Mirrors the
// existing RichTextViewer suite.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'

describe('RichTextViewer — callout & toggle', () => {
  it('renders a stored callout with its body and derived emoji', () => {
    const { container } = render(
      <RichTextViewer value='<div data-callout data-variant="warning"><p>be careful</p></div>' />
    )
    expect(screen.getByText('be careful')).toBeInTheDocument()
    const callout = container.querySelector(
      '[data-callout][data-variant="warning"]'
    )
    expect(callout).not.toBeNull()
    // Emoji is derived from the variant, not stored in the HTML.
    expect(container.textContent).toContain('⚠️')
  })

  it('defaults an unknown variant to info', () => {
    const { container } = render(
      <RichTextViewer value='<div data-callout data-variant="bogus"><p>hi</p></div>' />
    )
    expect(
      container.querySelector('[data-callout][data-variant="info"]')
    ).not.toBeNull()
    expect(container.textContent).toContain('💡')
  })

  it('renders a stored toggle: summary always visible, body present, open persisted', () => {
    const { container } = render(
      <RichTextViewer value='<div data-toggle data-open="true"><div data-toggle-summary>Details</div><div data-toggle-content><p>hidden body</p></div></div>' />
    )
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(screen.getByText('hidden body')).toBeInTheDocument()
    expect(
      container.querySelector('[data-toggle][data-open="true"]')
    ).not.toBeNull()
  })

  it('preserves a collapsed toggle (data-open="false") on round-trip', () => {
    const { container } = render(
      <RichTextViewer value='<div data-toggle data-open="false"><div data-toggle-summary>Closed</div><div data-toggle-content><p>body</p></div></div>' />
    )
    expect(
      container.querySelector('[data-toggle][data-open="false"]')
    ).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx jest __tests__/components/CalloutToggleViewer.test.tsx`
Expected: PASS (4 tests).

> If a test fails because the emoji isn't found, confirm `editor.isEditable` is `false` in `RichTextViewer` (it is — `editable: false`) so the plain-emoji branch renders. If the toggle body text isn't found, confirm `ToggleContent` content spec is `block+` and the stored HTML wraps the body in `<p>`.

- [ ] **Step 3: Commit**

```bash
git add __tests__/components/CalloutToggleViewer.test.tsx
git commit -m "test: callout + toggle render in read-only viewer [LUM-221]"
```

---

## Task 11: Full verification + manual smoke + PR

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Catches `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` issues jest misses.)

- [ ] **Step 2: Full test suite for touched areas**

Run: `npx jest __tests__/editor __tests__/components`
Expected: PASS.

- [ ] **Step 3: token-lint + lint**

Run: `npm run lint:tokens && npm run lint`
Expected: PASS. If `lint:tokens` flags an intentional color, do NOT add raw palette classes — move the color into `app/globals.css`.

- [ ] **Step 4: Manual smoke (dev server)**

Per project memory the preview browser can't reach the local dev server, so verify manually in your own browser: `npm run dev`, open a task description / document, type `/` and confirm:

- `Callout` and `Toggle` appear in the Advanced group with localized labels.
- Inserting a Callout shows the emoji; clicking it opens the 5-variant dropdown; selecting changes emoji + color; switch to dark mode and confirm contrast.
- Inserting a Toggle shows ▶ + summary + body; clicking ▶ collapses/expands and rotates the chevron; bold/@mention work in the summary.
- Reload the page (re-fetch from server) and confirm the callout variant and toggle open/closed state survived the save → round-trip.

(If you cannot run a browser, state that explicitly in the PR and rely on the jsdom viewer test + tsc for the round-trip guarantee.)

- [ ] **Step 5: Confirm no stray migration deletions / clean diff**

Run: `git fetch origin && git merge origin/main` (resolve if needed), then `git diff --stat origin/main` and confirm only the intended files changed and `prisma/migrations/` is untouched.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin lumo/LUM-221-callout-toggle
gh pr create --title "feat: Callout + Toggle editor blocks [LUM-221]" --body "$(cat <<'EOF'
## Summary
Adds two custom Tiptap blocks for the document editor:
- **Callout** — emoji + colored highlight, 5 variants (💡 Info / ⚠️ Warning / ✅ Success / 📝 Note / ❌ Error). Variant switched via a labeled dropdown on the emoji; only the variant is stored (emoji derived).
- **Toggle** — collapsible block with a rich-text summary + block body; expand/collapse state persisted so it round-trips into the read-only viewer.

Both wired into the slash menu (`/callout`, `/toggle`) and rendered identically in `DescriptionEditor` and `RichTextViewer` (shared `getBaseExtensions`).

## i18n
New editor keys added to all 16 locale files (real translations, no English fallback).

## Tests
- Pure unit tests: variant config, callout/toggle serialization helpers, slash-command items.
- jsdom integration: `RichTextViewer` renders stored callout + toggle HTML and preserves variant / open state.
- `tsc --noEmit`, `lint`, `lint:tokens` all pass.

## Notes
- No new npm packages. No schema/migration changes.
- Slash-menu labels for the two new items are localized; pre-existing built-in items remain hardcoded English (out of scope).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** 5 variants + fixed emoji (Task 1), labeled dropdown switcher (Task 3), block content model + serialization (Task 2), toggle summary/content child nodes + persisted open (Tasks 4–5), slash commands (Task 7), read-only rendering via shared extensions (Task 6 + Task 10), semantic-token/dark-mode styling (Task 9), i18n across 16 locales for new strings only (Task 8). ✅ All spec sections map to a task.
- **Placeholder scan:** NodeView "stubs" in Tasks 2/4 are intentional, fully-specified two-line files replaced in the immediately following task — not TODO placeholders. No "TBD"/"handle edge cases"/"add tests" placeholders. ✅
- **Type consistency:** `CalloutVariantKey`, `getCalloutVariant`, `calloutAttributesForVariant`, `CALLOUT_VARIANTS`, `ToggleExtensions`, `parseToggleOpen`, `renderToggleOpenAttr`, `SlashCommandTranslate`, `setCallout`, `setToggle` are defined once and referenced consistently across tasks and tests. Message ids in Task 8 match those used in Tasks 1/3/5/7. ✅
