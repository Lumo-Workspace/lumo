# Render Mermaid diagrams in documents — Design [LUM-256]

## Goal

Let document authors write a Mermaid diagram (flowchart, sequence, gantt, etc.)
and see it rendered as a diagram inline — in the editor, in the read-only
viewer, and (as source) in the document-history diff. Mermaid (`mermaid@11.14.0`)
is already a dependency; no new package is required.

## Decisions (settled during brainstorming)

| Question                | Decision                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration form        | **Dedicated Mermaid node + slash command** (not a language option on the existing code block)                                              |
| Edit/preview model      | **Dual-state**: shows the rendered diagram by default; click to enter an edit state with the source `textarea`; re-render on blur / "Done" |
| Invalid syntax handling | **Error placeholder** inside the block (red message with Mermaid's parse error) + an "Edit" button; source is never lost                   |
| History-diff rendering  | **Source diff only** — the diff view shows the Mermaid block as a source block with red/green markers; no diagram render in the diff       |
| Diagram types           | All Mermaid default types; no allowlist                                                                                                    |
| Dark mode               | Mermaid theme follows the app's current theme                                                                                              |

Out of scope (deferred): fullscreen preview, template library, PNG export,
live split-pane.

## Architecture

```
Component (DescriptionEditor / RichTextViewer)
  → getBaseExtensions()           lib/editor/extensions.ts   (register Mermaid)
      → Mermaid node              lib/editor/nodes/mermaid.ts
          → MermaidView           lib/editor/nodes/mermaid-view.tsx (ReactNodeViewRenderer)
              → renderMermaid()   lib/editor/mermaid-render.ts (parse + render, client-only)
Slash command                     lib/editor/slash-command-list.tsx (+ "/mermaid")
History diff                      RevisionDiffView (unchanged — sees stored source as text)
```

Follows the existing custom-node pattern modeled by
`lib/editor/nodes/code-block.ts` + `lib/editor/nodes/code-block-view.tsx`.

### Components

**`lib/editor/mermaid-render.ts`** — render helper, the only place that touches
the `mermaid` SDK.

- `parseMermaid(source): { ok: true } | { ok: false; error: string }` — wraps
  `mermaid.parse()` to surface syntax errors before rendering.
- `renderMermaid(id, source): Promise<string>` — wraps `mermaid.render()` and
  returns the SVG string.
- Calls `mermaid.initialize({ securityLevel: 'strict', theme: <app theme> })`.
- Runs **client-side only** (needs DOM). The node view invokes it from a
  `useEffect`; `RichTextViewer` already uses `immediatelyRender: false`.

**`lib/editor/nodes/mermaid.ts`** — `Node.create`:

- `group: 'block'`, `atom: true`, `selectable: true`.
- One attribute: `source` (string, the diagram code).
- `parseHTML`: matches `pre[data-type="mermaid"]`, reads the inner text as
  `source`.
- `renderHTML`: emits the source as **visible text content**:
  `<pre data-type="mermaid"><code>{source}</code></pre>`.
- `addNodeView`: `ReactNodeViewRenderer(MermaidView)`.

**`lib/editor/nodes/mermaid-view.tsx`** — React node view (dual-state):

- Reads `editor.isEditable`.
- **Read-only / view mode** (`!isEditable`, or editable but not being edited):
  renders the diagram SVG via `renderMermaid` in a `useEffect` keyed on
  `node.attrs.source` + theme. Click (when editable) → enter edit state.
- **Edit state** (editable only): shows a `textarea` bound to `source` +
  "Done" button. On blur / Done → `updateAttributes({ source })`, leave edit
  state, re-render.
- **Error state**: on render/parse failure show a red placeholder with the
  Mermaid error message + an "Edit" button; source is preserved.
- All controls `contentEditable={false}` + `onMouseDown` stopPropagation, same
  as `code-block-view.tsx`.

**Slash command** — add `/mermaid` to `lib/editor/slash-command-list.tsx`,
inserting a Mermaid node seeded with a default `graph TD` template. Wire the
label through react-intl with new i18n keys.

### Storage / serialization (the key choice)

The Mermaid source is stored as **visible text** inside
`<pre data-type="mermaid"><code>…source…</code></pre>`. Consequences:

- Round-trips through tiptap's HTML (the stored doc format) without a separate
  data channel.
- `RevisionDiffView` does a **plain HTML text diff** with no editor instance.
  Because the source lives as text in the stored HTML, the diff view shows the
  Mermaid block as a source block with `<ins>/<del>` markers **for free** — the
  "source diff only" decision needs **zero** diff-specific code.

## Error handling

- `parseMermaid` runs before `renderMermaid`; a parse failure short-circuits to
  the error placeholder with the returned message.
- A `renderMermaid` rejection (rare, post-parse) is caught and shown the same
  way.
- Source is never discarded on error — the "Edit" button reopens the source.

## Security

- `mermaid.initialize({ securityLevel: 'strict' })` to neutralize script/HTML
  injection in diagram labels. The SVG is inserted into the node view via React;
  no `dangerouslySetInnerHTML` of untrusted Mermaid output beyond the sandboxed,
  strict-mode SVG.

## Testing

- `mermaid-render.ts` unit tests: valid source → SVG string; invalid →
  `{ ok: false, error }`. Mock `mermaid` under jsdom.
- Node `parseHTML` / `renderHTML` round-trip: HTML ↔ `source` is lossless.
- `MermaidView` component tests (jsdom, existing pattern): read-only mode is not
  editable; error state shows the placeholder + Edit button; entering edit state
  shows the source `textarea`.

## i18n

New user-facing strings (slash-command label, "Done"/"Edit" buttons, error
prefix) added to **all 16 locale files** in the same PR with real translations
(per the strict locale-parity test).

## Files

New:

- `lib/editor/mermaid-render.ts`
- `lib/editor/nodes/mermaid.ts`
- `lib/editor/nodes/mermaid-view.tsx`
- `__tests__/…` for the three test groups above

Modified:

- `lib/editor/extensions.ts` (register node)
- `lib/editor/slash-command-list.tsx` (add `/mermaid`)
- `lib/i18n/*.json` (16 locales)

No schema change, no API/service/repository change (pure client editor feature).
