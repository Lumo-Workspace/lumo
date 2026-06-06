# Mermaid Diagrams in Documents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let document authors insert a Mermaid diagram via `/mermaid`, see it rendered inline (editor + read-only viewer), edit its source in a dual-state block, and have the source show up in document-history diffs.

**Architecture:** A dedicated Tiptap `mermaid` atom node stores the diagram source as visible text inside `<pre data-type="mermaid"><code>…</code></pre>`. Its React node view renders the diagram via a `mermaid`-SDK wrapper (client-only, dynamic import) and toggles to a source `textarea` on click when editable. Because the source is stored as text, the existing HTML-text-diff `RevisionDiffView` shows source diffs with zero extra code.

**Tech Stack:** Tiptap v3 (`@tiptap/core`, `@tiptap/react`), `mermaid@11.14.0` (already a dependency), `next-themes`, `react-intl`, Jest + jsdom.

---

## File Structure

New files:

- `lib/editor/mermaid-render.ts` — the only module that touches the `mermaid` SDK. Dynamic-imports mermaid (keeps it out of the static jest graph), exposes one async `renderMermaid()` returning a discriminated union.
- `lib/editor/nodes/mermaid.ts` — the Tiptap `mermaid` node (attributes, parse/render HTML, `setMermaid` command, node view wiring).
- `lib/editor/nodes/mermaid-view.tsx` — the dual-state React node view (diagram / edit / error).
- `__tests__/editor/mermaid-render.test.ts` — unit tests for the render wrapper (mocks `mermaid`).
- `__tests__/editor/mermaid-node.test.tsx` — node identity + round-trip + read-only render + error placeholder (mocks `@/lib/editor/mermaid-render`).

Modified files:

- `lib/editor/extensions.ts` — register `Mermaid` in `getBaseExtensions()`.
- `lib/editor/slash-command.tsx` — add the `/mermaid` item + fallback labels.
- `lib/i18n/*.json` (all 16 locales) — 6 new keys.

> **Note on a minor spec consolidation:** the spec listed `parseMermaid` + `renderMermaid` as two functions. This plan ships a single `renderMermaid()` that runs `mermaid.parse()` then `mermaid.render()` internally and returns `{ ok: true; svg } | { ok: false; error }`. Same behavior, simpler call sites and tests.

---

## Task 1: Mermaid render wrapper

**Files:**

- Create: `lib/editor/mermaid-render.ts`
- Test: `__tests__/editor/mermaid-render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/editor/mermaid-render.test.ts`:

```ts
// __tests__/editor/mermaid-render.test.ts
// mermaid ships heavy untranspiled ESM (d3, etc.) that jest cannot load as
// CJS. We never want the real SDK in the test graph, so mock it. renderMermaid
// dynamic-imports 'mermaid', and jest.mock intercepts dynamic imports too.
const initialize = jest.fn()
const parse = jest.fn()
const render = jest.fn()

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize, parse, render },
}))

import { renderMermaid } from '@/lib/editor/mermaid-render'

beforeEach(() => {
  initialize.mockClear()
  parse.mockReset()
  render.mockReset()
})

describe('renderMermaid', () => {
  it('returns the SVG for valid source', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg>ok</svg>' })

    const result = await renderMermaid(
      'mermaid-1',
      'graph TD\n A-->B',
      'default'
    )

    expect(result).toEqual({ ok: true, svg: '<svg>ok</svg>' })
    expect(render).toHaveBeenCalledWith('mermaid-1', 'graph TD\n A-->B')
  })

  it('returns the error message for invalid source (parse throws)', async () => {
    parse.mockRejectedValue(new Error('Parse error on line 2'))

    const result = await renderMermaid('mermaid-2', 'grraph TD', 'default')

    expect(result).toEqual({ ok: false, error: 'Parse error on line 2' })
    expect(render).not.toHaveBeenCalled()
  })

  it('initializes with strict security and the requested theme', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg/>' })

    await renderMermaid('mermaid-3', 'graph TD\n A-->B', 'dark')

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        theme: 'dark',
        startOnLoad: false,
      })
    )
  })

  it('re-initializes when the theme changes between calls', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg/>' })

    await renderMermaid('a', 'graph TD\n A-->B', 'default')
    await renderMermaid('b', 'graph TD\n A-->B', 'default')
    await renderMermaid('c', 'graph TD\n A-->B', 'dark')

    // default (1st) → cached (2nd, no re-init) → dark (3rd, re-init) = 2 calls
    expect(initialize).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/editor/mermaid-render.test.ts`
Expected: FAIL — `Cannot find module '@/lib/editor/mermaid-render'`.

- [ ] **Step 3: Write the implementation**

Create `lib/editor/mermaid-render.ts`:

```ts
// lib/editor/mermaid-render.ts

/** Mermaid built-in theme name keyed off the app's resolved color scheme. */
export type MermaidTheme = 'default' | 'dark'

/** Discriminated result so callers never deal with thrown errors. */
export type MermaidRenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string }

// Track the theme mermaid was last initialized with so we only re-init on
// change (initialize is global + not free).
let initializedTheme: MermaidTheme | null = null

// Dynamic import keeps the heavy mermaid ESM bundle out of any static import
// graph (server bundles, jest module graph). Mirrors the dynamic-import
// pattern used for other ESM-only deps in this repo.
async function getMermaid() {
  const mod = await import('mermaid')
  return mod.default
}

/**
 * Parse + render a Mermaid diagram to an SVG string. Client-only (mermaid
 * needs the DOM). Returns a discriminated union instead of throwing so the
 * node view can show an inline error placeholder. `securityLevel: 'strict'`
 * neutralizes script/HTML injection in diagram labels.
 */
export async function renderMermaid(
  id: string,
  source: string,
  theme: MermaidTheme
): Promise<MermaidRenderResult> {
  try {
    const mermaid = await getMermaid()
    if (initializedTheme !== theme) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
      initializedTheme = theme
    }
    // parse() throws on invalid syntax with a human-readable message.
    await mermaid.parse(source)
    const { svg } = await mermaid.render(id, source)
    return { ok: true, svg }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/editor/mermaid-render.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/mermaid-render.ts __tests__/editor/mermaid-render.test.ts
git commit -m "feat: add mermaid render wrapper [LUM-256]"
```

---

## Task 2: Mermaid node + node view

**Files:**

- Create: `lib/editor/nodes/mermaid.ts`
- Create: `lib/editor/nodes/mermaid-view.tsx`
- Modify: `lib/editor/extensions.ts`
- Test: `__tests__/editor/mermaid-node.test.tsx`

- [ ] **Step 1: Write the node view**

Create `lib/editor/nodes/mermaid-view.tsx`:

```tsx
// lib/editor/nodes/mermaid-view.tsx
import { useEffect, useId, useState } from 'react'
import { useTheme } from 'next-themes'
import { useIntl } from 'react-intl'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { renderMermaid } from '../mermaid-render'

/**
 * Dual-state node view for the Mermaid block. Default state renders the
 * diagram SVG; clicking (only while editable) opens a source textarea that
 * re-renders on blur / "Done". A render/parse failure shows an inline error
 * placeholder with an "Edit" button — the source is never discarded. The
 * read-only RichTextViewer (editor.isEditable === false) only ever shows the
 * diagram.
 */
export function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const intl = useIntl()
  const { resolvedTheme } = useTheme()
  const source = (node.attrs.source as string) ?? ''

  // useId is pure (no Math.random in render, per the React rules). Strip the
  // colons next-id emits so it's a valid mermaid/DOM id.
  const domId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(source)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const theme = resolvedTheme === 'dark' ? 'dark' : 'default'

  useEffect(() => {
    if (editing || source.trim() === '') return
    let cancelled = false
    void renderMermaid(domId, source, theme).then(result => {
      if (cancelled) return
      if (result.ok) {
        setSvg(result.svg)
        setError(null)
      } else {
        setSvg(null)
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [source, theme, editing, domId])

  function openEditor() {
    if (!editor.isEditable) return
    setDraft(source)
    setEditing(true)
  }

  function commit() {
    updateAttributes({ source: draft })
    setEditing(false)
  }

  if (editing) {
    return (
      <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
        <div className='mermaid-edit' contentEditable={false}>
          <textarea
            className='mermaid-source'
            value={draft}
            autoFocus
            aria-label={intl.formatMessage({
              id: 'editor.mermaid.edit',
              defaultMessage: 'Edit',
            })}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onMouseDown={e => e.stopPropagation()}
          />
          <button
            type='button'
            className='mermaid-done'
            onMouseDown={e => {
              // mousedown fires before the textarea blur; commit here so the
              // click isn't swallowed by the blur re-render.
              e.preventDefault()
              commit()
            }}
          >
            {intl.formatMessage({
              id: 'editor.mermaid.done',
              defaultMessage: 'Done',
            })}
          </button>
        </div>
      </NodeViewWrapper>
    )
  }

  if (error) {
    return (
      <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
        <div className='mermaid-error' contentEditable={false} role='alert'>
          <span className='mermaid-error-message'>
            {intl.formatMessage({
              id: 'editor.mermaid.error',
              defaultMessage: 'Diagram error',
            })}
            : {error}
          </span>
          {editor.isEditable && (
            <button
              type='button'
              className='mermaid-edit-button'
              onMouseDown={e => {
                e.preventDefault()
                openEditor()
              }}
            >
              {intl.formatMessage({
                id: 'editor.mermaid.edit',
                defaultMessage: 'Edit',
              })}
            </button>
          )}
        </div>
      </NodeViewWrapper>
    )
  }

  if (source.trim() === '') {
    return (
      <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
        <div
          className='mermaid-empty'
          contentEditable={false}
          onClick={openEditor}
        >
          {intl.formatMessage({
            id: 'editor.mermaid.empty',
            defaultMessage: 'Empty diagram — click to edit',
          })}
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
      <div
        className='mermaid-diagram'
        contentEditable={false}
        onClick={openEditor}
        // mermaid output is sanitized (securityLevel: 'strict').
        dangerouslySetInnerHTML={{ __html: svg ?? '' }}
      />
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 2: Write the node**

Create `lib/editor/nodes/mermaid.ts`:

```ts
// lib/editor/nodes/mermaid.ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MermaidView } from './mermaid-view'

/** Seed source inserted by the slash command so a fresh block renders. */
export const DEFAULT_MERMAID_SOURCE = 'graph TD\n  A[Start] --> B[End]'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Insert a Mermaid block (defaults to the starter template). */
      setMermaid: (attrs?: { source?: string }) => ReturnType
    }
  }
}

/**
 * Mermaid diagram block. Atom node (no editable inner content) whose `source`
 * is serialized as VISIBLE text inside `<pre data-type="mermaid"><code>…</code></pre>`.
 * Storing the source as text means the HTML-text-diff RevisionDiffView shows
 * source diffs for free. The same node view runs in the editor and the
 * read-only RichTextViewer (both call getBaseExtensions).
 */
export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        // Read the diagram source from the element's text content.
        parseHTML: el => el.textContent ?? '',
        // Source is emitted as text content in renderHTML, not as an attribute.
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'pre[data-type="mermaid"]' }]
  },

  renderHTML({ node }) {
    return [
      'pre',
      mergeAttributes({ 'data-type': 'mermaid' }),
      ['code', {}, (node.attrs.source as string) ?? ''],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      setMermaid:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { source: attrs.source ?? DEFAULT_MERMAID_SOURCE },
          }),
    }
  },
})
```

- [ ] **Step 3: Register the node**

Modify `lib/editor/extensions.ts`. Add the import next to the other node imports:

```ts
import { Mermaid } from './nodes/mermaid'
```

And add `Mermaid` to the returned array, right after `Callout` (keep the block nodes grouped):

```ts
    Callout,
    Mermaid,
    ...ToggleExtensions,
```

- [ ] **Step 4: Write the failing test**

Create `__tests__/editor/mermaid-node.test.tsx`:

```tsx
// __tests__/editor/mermaid-node.test.tsx
/** @jest-environment jsdom */

// NodeViews import react-intl (untranspiled ESM); stub it like the existing
// CalloutToggleViewer suite.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

// next-themes useTheme needs a provider; stub it to a fixed theme.
jest.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))

// Mock the render wrapper so no real mermaid SDK is loaded and we control
// success/failure deterministically.
const renderMermaid = jest.fn()
jest.mock('@/lib/editor/mermaid-render', () => ({
  renderMermaid: (...args: unknown[]) => renderMermaid(...args),
}))

import { render, screen, waitFor } from '@testing-library/react'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'
import { Mermaid, DEFAULT_MERMAID_SOURCE } from '@/lib/editor/nodes/mermaid'

const STORED =
  '<pre data-type="mermaid"><code>graph TD\n  A--&gt;B</code></pre>'

beforeEach(() => renderMermaid.mockReset())

describe('Mermaid node', () => {
  it('is a Tiptap node named "mermaid" with a starter template', () => {
    expect(Mermaid.name).toBe('mermaid')
    expect(DEFAULT_MERMAID_SOURCE).toContain('graph TD')
  })

  it('renders stored source as a diagram in the read-only viewer', async () => {
    renderMermaid.mockResolvedValue({
      ok: true,
      svg: '<svg data-testid="diagram">D</svg>',
    })

    render(<RichTextViewer value={STORED} />)

    await waitFor(() =>
      expect(screen.getByTestId('diagram')).toBeInTheDocument()
    )
    // parseHTML pulled the source text out of <code> and passed it through.
    expect(renderMermaid).toHaveBeenCalledWith(
      expect.any(String),
      'graph TD\n  A-->B',
      'default'
    )
  })

  it('shows an inline error placeholder when rendering fails', async () => {
    renderMermaid.mockResolvedValue({
      ok: false,
      error: 'Parse error on line 1',
    })

    const { container } = render(<RichTextViewer value={STORED} />)

    await waitFor(() =>
      expect(container.querySelector('.mermaid-error')).not.toBeNull()
    )
    expect(container.textContent).toContain('Parse error on line 1')
  })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/editor/mermaid-node.test.tsx`
Expected: PASS (3 tests). If `getByTestId('diagram')` is not found, confirm `dangerouslySetInnerHTML` is wired and `RichTextViewer` includes the node via `getBaseExtensions`.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/nodes/mermaid.ts lib/editor/nodes/mermaid-view.tsx lib/editor/extensions.ts __tests__/editor/mermaid-node.test.tsx
git commit -m "feat: add mermaid tiptap node + dual-state node view [LUM-256]"
```

---

## Task 3: Slash command + styling

**Files:**

- Modify: `lib/editor/slash-command.tsx`
- Modify: `app/globals.css` (or the editor stylesheet that styles `.callout` / `.code-block-wrapper`)

- [ ] **Step 1: Add the slash-command item**

In `lib/editor/slash-command.tsx`, add `Workflow` to the existing `lucide-react` import:

```ts
import {
  // …existing icons…
  LayoutList,
  Workflow,
} from 'lucide-react'
```

Add these entries to the `FALLBACK_LABELS` map (in the Advanced items block):

```ts
  'editor.slash.mermaid.title': 'Mermaid Diagram',
  'editor.slash.mermaid.description': 'Diagram from text',
```

Add this item to the array returned by `getSlashCommandItems`, immediately after the Task View item (last Advanced entry):

```ts
    {
      title: t('editor.slash.mermaid.title'),
      description: t('editor.slash.mermaid.description'),
      icon: <Workflow size={ICON_SIZE} />,
      categoryKey: 'advanced',
      category: t('editor.slash.category.advanced'),
      command: editor => editor.chain().focus().setMermaid().run(),
    },
```

- [ ] **Step 2: Add minimal styling**

Find where `.callout` / `.code-block-wrapper` editor blocks are styled (search: `grep -rn "code-block-wrapper" app/globals.css` — use that file). Append, using semantic tokens (NOT raw zinc/gray — repo runs `lint:tokens`):

```css
.mermaid-block {
  margin: 0.75rem 0;
}
.mermaid-diagram,
.mermaid-empty {
  display: flex;
  justify-content: center;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  cursor: pointer;
}
.mermaid-empty {
  color: var(--muted-foreground);
}
.mermaid-source {
  width: 100%;
  min-height: 6rem;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--muted);
  color: var(--foreground);
}
.mermaid-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--destructive);
  border-radius: 0.5rem;
  color: var(--destructive);
  font-size: 0.8rem;
}
```

- [ ] **Step 3: Verify token lint passes**

Run: `npm run lint:tokens`
Expected: PASS (no new raw-color violations). If it flags `--destructive`/`--border`/`--muted`, confirm those tokens exist in `app/globals.css`; substitute the closest existing semantic token if not.

- [ ] **Step 4: Commit**

```bash
git add lib/editor/slash-command.tsx app/globals.css
git commit -m "feat: add /mermaid slash command + block styling [LUM-256]"
```

---

## Task 4: i18n — add 6 keys to all 16 locales

**Files:**

- Modify: `lib/i18n/{en,en-AU,en-GB,de,es,es-419,fr,hi,id,ja,ko,ms,ru,vi,zh-CN,zh-TW}.json`

> The repo's strict locale-parity test (`__tests__/i18n-locale-parity.test.ts`) fails if any locale is missing a key present in `en.json` or has an empty value. Add all 6 keys to **every** file with a real translation in the same commit. Keys are flat dotted strings; insert them near the other `editor.slash.*` / `editor.*` keys and keep 2-space JSON formatting.

- [ ] **Step 1: Add the keys to every locale**

Add these 6 keys to each file with the values from the table below:

| Key                                | en / en-AU / en-GB            |
| ---------------------------------- | ----------------------------- |
| `editor.slash.mermaid.title`       | Mermaid Diagram               |
| `editor.slash.mermaid.description` | Diagram from text             |
| `editor.mermaid.edit`              | Edit                          |
| `editor.mermaid.done`              | Done                          |
| `editor.mermaid.error`             | Diagram error                 |
| `editor.mermaid.empty`             | Empty diagram — click to edit |

Translations per locale (order: title / description / edit / done / error / empty):

- **de:** `Mermaid-Diagramm` / `Diagramm aus Text` / `Bearbeiten` / `Fertig` / `Diagrammfehler` / `Leeres Diagramm – zum Bearbeiten klicken`
- **es:** `Diagrama Mermaid` / `Diagrama a partir de texto` / `Editar` / `Listo` / `Error del diagrama` / `Diagrama vacío: haz clic para editar`
- **es-419:** `Diagrama Mermaid` / `Diagrama a partir de texto` / `Editar` / `Listo` / `Error del diagrama` / `Diagrama vacío: haz clic para editar`
- **fr:** `Diagramme Mermaid` / `Diagramme à partir de texte` / `Modifier` / `Terminé` / `Erreur de diagramme` / `Diagramme vide — cliquez pour modifier`
- **hi:** `Mermaid आरेख` / `टेक्स्ट से आरेख` / `संपादित करें` / `हो गया` / `आरेख त्रुटि` / `खाली आरेख — संपादित करने के लिए क्लिक करें`
- **id:** `Diagram Mermaid` / `Diagram dari teks` / `Edit` / `Selesai` / `Kesalahan diagram` / `Diagram kosong — klik untuk mengedit`
- **ja:** `Mermaid 図` / `テキストから図を作成` / `編集` / `完了` / `図のエラー` / `空の図 — クリックして編集`
- **ko:** `Mermaid 다이어그램` / `텍스트로 만드는 다이어그램` / `편집` / `완료` / `다이어그램 오류` / `빈 다이어그램 — 클릭하여 편집`
- **ms:** `Rajah Mermaid` / `Rajah daripada teks` / `Edit` / `Selesai` / `Ralat rajah` / `Rajah kosong — klik untuk edit`
- **ru:** `Диаграмма Mermaid` / `Диаграмма из текста` / `Изменить` / `Готово` / `Ошибка диаграммы` / `Пустая диаграмма — нажмите, чтобы изменить`
- **vi:** `Sơ đồ Mermaid` / `Sơ đồ từ văn bản` / `Sửa` / `Xong` / `Lỗi sơ đồ` / `Sơ đồ trống — nhấp để chỉnh sửa`
- **zh-CN:** `Mermaid 图表` / `用文本生成图表` / `编辑` / `完成` / `图表错误` / `空图表 — 点击编辑`
- **zh-TW:** `Mermaid 圖表` / `用文字產生圖表` / `編輯` / `完成` / `圖表錯誤` / `空圖表 — 點擊編輯`

- [ ] **Step 2: Run the locale-parity test**

Run: `npx jest __tests__/i18n-locale-parity.test.ts`
Expected: PASS — all 16 locales have the 6 new keys, all non-empty.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/*.json
git commit -m "i18n: add mermaid block strings to all locales [LUM-256]"
```

---

## Task 5: Full verification

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Watch for `exactOptionalPropertyTypes` on the `setMermaid` attrs and `noUncheckedIndexedAccess` — both are on in this repo.)

- [ ] **Step 2: Run the full mermaid + editor + i18n suites**

Run: `npx jest __tests__/editor/mermaid-render.test.ts __tests__/editor/mermaid-node.test.tsx __tests__/i18n-locale-parity.test.ts`
Expected: all PASS.

- [ ] **Step 3: Token lint**

Run: `npm run lint:tokens`
Expected: PASS.

- [ ] **Step 4: Manual confirm (optional, if a dev server is reachable)**

In a document: type `/mermaid` → a diagram renders; click it → source `textarea`; edit to invalid syntax → blur → error placeholder + Edit button; open document history → the mermaid source appears with red/green diff markers.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin lumo/LUM-256-mermaid-diagrams
gh pr create --title "feat: render Mermaid diagrams in documents [LUM-256]" \
  --body "Adds a /mermaid Tiptap block that renders Mermaid diagrams inline (editor + read-only viewer), with a dual-state edit experience and an inline error placeholder. Source is stored as text so document-history diffs show source diffs with no extra code. No schema/API change. Uses existing mermaid@11.14.0 dependency."
```

---

## Self-Review Notes

- **Spec coverage:** node + slash command (Task 2/3), dual-state edit (Task 2 view), error placeholder (Task 2 view + test), source-as-text storage / history-diff for-free (Task 2 node), strict security + theme (Task 1), all-16-locale i18n (Task 4), tests for render/node/round-trip/error (Tasks 1–2). History-diff needs no code change by design — verified manually in Task 5 Step 4.
- **Type consistency:** `renderMermaid(id, source, theme)` and `MermaidRenderResult` used identically in Task 1, the node view (Task 2), and both test files. `setMermaid` command + `DEFAULT_MERMAID_SOURCE` declared in Task 2, consumed in Task 3.
- **Round-trip:** the Task 2 read-only render test exercises `parseHTML` (source pulled from `<code>` text); `renderHTML` is exercised implicitly by `RichTextViewer` re-serializing — adequate without a separate editable-editor harness.
