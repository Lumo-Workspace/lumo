# LUM-211 Split DescriptionEditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 896-line `DescriptionEditor.tsx` into four focused units (a node module, an image-insert module, a `useImageUploads` hook with a unified `trackUpload` helper, and a `useTocSync` hook) with zero behavior change.

**Architecture:** Extract pure/UI-free logic into `lib/editor/`, extract stateful React logic into `app/workspace/[workspaceUrl]/hooks/`, then thin the component to wiring + JSX. `lib/editor/` stays free of `sonner`/toast — `insertImageWithUpload` reports failure via an injected `onError()` callback. The upload pending-tracking is named `trackUpload(promise)` and lives entirely inside `useImageUploads`; `onBlur` calls only `runOrDeferCommit(commit)`.

**Tech Stack:** Next.js 14, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tiptap, React, Jest + @testing-library/react, react-intl, sonner.

**Worktree:** `.worktrees/LUM-211-split-description-editor` (branch `lumo/LUM-211-split-description-editor`). Run **all** jest/tsc with cwd inside this worktree (haste collision otherwise). Baseline: `npx jest __tests__/editor/` = 22 passing.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/editor/nodes/mention-with-type.ts` (create) | `MentionWithType` extension + pure `renderMentionHTML`/`renderMentionText` |
| `lib/editor/insert-image-with-upload.ts` (create) | `insertImageWithUpload` (UI-free, `onError` callback) |
| `app/workspace/[workspaceUrl]/hooks/useImageUploads.ts` (create) | upload chain: validate → `trackUpload` → insert; `runOrDeferCommit` |
| `app/workspace/[workspaceUrl]/hooks/useTocSync.ts` (create) | `TocItem` type + the TOC sync effect |
| `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` (modify) | wiring + `useEditor` config + extract handlers + JSX; re-export `TocItem` |
| Tests (create) | one `*.test.ts(x)` per new unit |

---

## Task 1: Extract `MentionWithType` node

**Files:**
- Create: `lib/editor/nodes/mention-with-type.ts`
- Test: `__tests__/editor/mention-with-type.test.ts`
- Modify: `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` (remove the inline node, import from the new module)

- [ ] **Step 1: Write the failing test**

Create `__tests__/editor/mention-with-type.test.ts`:

```ts
import {
  renderMentionHTML,
  renderMentionText,
  MentionWithType,
} from '@/lib/editor/nodes/mention-with-type'

describe('renderMentionText', () => {
  it('renders a user mention as @label', () => {
    expect(
      renderMentionText({ mentionType: 'user', label: 'alice', id: '1' })
    ).toBe('@alice')
  })

  it('falls back to id when a user mention has no label', () => {
    expect(
      renderMentionText({ mentionType: 'user', label: null, id: '1' })
    ).toBe('@1')
  })

  it('renders a task mention as "label title" when a title is present', () => {
    expect(
      renderMentionText({
        mentionType: 'task',
        label: 'LUM-5',
        mentionTitle: 'Fix bug',
        id: '5',
      })
    ).toBe('LUM-5 Fix bug')
  })

  it('renders a task mention as just the label when no title', () => {
    expect(
      renderMentionText({
        mentionType: 'task',
        label: 'LUM-5',
        mentionTitle: null,
        id: '5',
      })
    ).toBe('LUM-5')
  })
})

describe('renderMentionHTML', () => {
  it('tags a task mention with mention-task class + data attrs', () => {
    const [tag, attrs, text] = renderMentionHTML(
      {
        mentionType: 'task',
        label: 'LUM-5',
        mentionTitle: 'Fix bug',
        mentionStatus: 'IN_PROGRESS',
        id: '5',
      },
      {}
    )
    expect(tag).toBe('span')
    expect(attrs.class).toBe('mention mention-task')
    expect(attrs['data-mention-type']).toBe('task')
    expect(attrs['data-mention-status']).toBe('IN_PROGRESS')
    expect(text).toBe('LUM-5 Fix bug')
  })

  it('omits data-mention-status when status is null', () => {
    const [, attrs] = renderMentionHTML(
      { mentionType: 'task', label: 'LUM-5', mentionStatus: null, id: '5' },
      {}
    )
    expect('data-mention-status' in attrs).toBe(false)
  })

  it('renders a user mention with the plain mention class and @label', () => {
    const [tag, attrs, text] = renderMentionHTML(
      { mentionType: 'user', label: 'alice', id: '1' },
      {}
    )
    expect(tag).toBe('span')
    expect(attrs.class).toBe('mention')
    expect(text).toBe('@alice')
  })
})

describe('MentionWithType', () => {
  it('is a configured Tiptap extension named "mention"', () => {
    expect(MentionWithType.name).toBe('mention')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/editor/mention-with-type.test.ts`
Expected: FAIL — cannot find module `@/lib/editor/nodes/mention-with-type`.

- [ ] **Step 3: Create the module**

Create `lib/editor/nodes/mention-with-type.ts`. The `attrs` parameter is typed via ProseMirror's node attrs (`Record<string, any>`) so field access stays `any` — this preserves the original inline code's behavior exactly (the original read `node.attrs.label` etc. off an `any` record). Do **not** narrow it to a strict interface or tsc will reject the `string | null` text slot.

```ts
import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

type MentionAttrs = ProseMirrorNode['attrs']

/** Pure: the DOM-spec array a mention node's renderHTML returns. */
export function renderMentionHTML(
  attrs: MentionAttrs,
  HTMLAttributes: Record<string, unknown>
) {
  const isTask = attrs.mentionType === 'task'
  if (isTask) {
    const label = attrs.label ?? attrs.id
    const title = attrs.mentionTitle ?? ''
    const text = title ? `${label} ${title}` : label
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'mention mention-task',
        'data-mention-type': 'task',
        ...(attrs.mentionStatus
          ? { 'data-mention-status': attrs.mentionStatus }
          : {}),
      }),
      text,
    ]
  }
  return [
    'span',
    mergeAttributes(HTMLAttributes, { class: 'mention' }),
    `@${attrs.label ?? attrs.id}`,
  ]
}

/** Pure: the plain-text representation a mention node's renderText returns. */
export function renderMentionText(attrs: MentionAttrs): string {
  const isTask = attrs.mentionType === 'task'
  if (isTask) {
    const label = attrs.label ?? attrs.id
    return attrs.mentionTitle ? `${label} ${attrs.mentionTitle}` : label
  }
  return `@${attrs.label ?? attrs.id}`
}

/** Mention node extended with type / title / status attributes. */
export const MentionWithType = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mentionType: {
        default: 'user',
        parseHTML: el => el.getAttribute('data-mention-type') ?? 'user',
        renderHTML: attrs => ({ 'data-mention-type': attrs.mentionType }),
      },
      mentionTitle: {
        default: null,
        parseHTML: el => el.getAttribute('data-mention-title') ?? null,
        renderHTML: attrs =>
          attrs.mentionTitle ? { 'data-mention-title': attrs.mentionTitle } : {},
      },
      mentionStatus: {
        default: null,
        parseHTML: el => el.getAttribute('data-mention-status') ?? null,
        renderHTML: attrs =>
          attrs.mentionStatus
            ? { 'data-mention-status': attrs.mentionStatus }
            : {},
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    return renderMentionHTML(node.attrs, HTMLAttributes)
  },
  renderText({ node }) {
    return renderMentionText(node.attrs)
  },
})
```

- [ ] **Step 4: Remove the inline node from the component**

In `DescriptionEditor.tsx`:
- Delete the inline `const MentionWithType = Mention.extend({...})` block (original lines ~43-104).
- Delete the now-unused imports `Mention` (line 9) and `mergeAttributes` (line 10) **only if** nothing else uses them (grep first; they are only used by the deleted block).
- Add to the local imports group: `import { MentionWithType } from '@/lib/editor/nodes/mention-with-type'`.
- Leave the `MentionWithType.configure({...})` usage in the extensions array unchanged.

- [ ] **Step 5: Run tests + tsc**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/editor/mention-with-type.test.ts && npx tsc --noEmit`
Expected: jest PASS (8 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/nodes/mention-with-type.ts __tests__/editor/mention-with-type.test.ts "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
git commit -m "refactor: extract MentionWithType node module [LUM-211]"
```

---

## Task 2: Extract `insertImageWithUpload` (UI-free, onError callback)

**Files:**
- Create: `lib/editor/insert-image-with-upload.ts`
- Test: `__tests__/editor/insert-image-with-upload.test.ts`
- Modify: `DescriptionEditor.tsx` (remove the inline function; it will be called from the hook in Task 3, so no call site remains in the component after Task 3 — for now leave `enqueueImageUpload` calling the imported version)

- [ ] **Step 1: Write the failing test**

Create `__tests__/editor/insert-image-with-upload.test.ts`. Mocks `uploadImageFile`; supplies a minimal editor stub. Covers the null-editor guard and the failure→`onError`+revoke path (the swap-success path requires a full ProseMirror doc and is left to the component-level confidence + tsc — documented in the spec).

```ts
import { insertImageWithUpload } from '@/lib/editor/insert-image-with-upload'
import { uploadImageFile } from '@/lib/editor/image-upload'

jest.mock('@/lib/editor/image-upload', () => ({
  uploadImageFile: jest.fn(),
}))

const mockedUpload = uploadImageFile as jest.MockedFunction<typeof uploadImageFile>

beforeEach(() => {
  jest.clearAllMocks()
  // jsdom lacks object-URL APIs
  global.URL.createObjectURL = jest.fn(() => 'blob:fake')
  global.URL.revokeObjectURL = jest.fn()
})

/** Editor stub with an empty doc — descendants never matches, so the swap/
 *  remove loops are exercised without finding a node (safe for these paths). */
function emptyEditorStub() {
  return {
    chain: () => ({
      focus: () => ({
        insertContentAt: () => ({ run: () => true }),
        setImage: () => ({ run: () => true }),
      }),
    }),
    state: { doc: { descendants: () => {} }, tr: {} },
    view: { dispatch: () => {} },
  } as unknown as import('@tiptap/core').Editor
}

it('revokes the object URL and returns when there is no editor', async () => {
  const onError = jest.fn()
  await insertImageWithUpload(
    new File(['x'], 'p', { type: 'image/png' }),
    'doc1',
    () => null,
    undefined,
    onError
  )
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  expect(mockedUpload).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

it('calls onError and revokes when the upload returns no URL', async () => {
  mockedUpload.mockResolvedValue(null)
  const onError = jest.fn()
  const ed = emptyEditorStub()
  await insertImageWithUpload(
    new File(['x'], 'p', { type: 'image/png' }),
    'doc1',
    () => ed,
    undefined,
    onError
  )
  expect(mockedUpload).toHaveBeenCalledTimes(1)
  expect(onError).toHaveBeenCalledTimes(1)
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
})

it('does not call onError on a successful upload', async () => {
  mockedUpload.mockResolvedValue('https://cdn/img.png')
  const onError = jest.fn()
  const ed = emptyEditorStub()
  await insertImageWithUpload(
    new File(['x'], 'p', { type: 'image/png' }),
    'doc1',
    () => ed,
    undefined,
    onError
  )
  expect(onError).not.toHaveBeenCalled()
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/editor/insert-image-with-upload.test.ts`
Expected: FAIL — cannot find module `@/lib/editor/insert-image-with-upload`.

- [ ] **Step 3: Create the module**

Create `lib/editor/insert-image-with-upload.ts`. This is the original function body moved verbatim, with two changes only: `errorMessage?: string` becomes `onError: () => void`, and the `catch` calls `onError()` instead of `toast.error(...)`. `insertPos` is typed `number | undefined` (not optional) so callers can pass `undefined` explicitly under `exactOptionalPropertyTypes`.

```ts
import type { Editor } from '@tiptap/core'
import { uploadImageFile } from './image-upload'

/**
 * Insert an image immediately using a local blob URL for instant preview,
 * upload in the background, then swap the src to the real CDN URL when done.
 * On failure, removes the placeholder and invokes `onError` (the caller owns
 * any user-facing toast — this module stays UI-free).
 *
 * Returns a Promise that resolves when the upload is settled (success or fail),
 * so callers can track pending uploads before committing the document.
 */
export async function insertImageWithUpload(
  file: File,
  documentId: string | undefined,
  getEditor: () => Editor | null,
  insertPos: number | undefined,
  onError: () => void
): Promise<void> {
  const tempUrl = URL.createObjectURL(file)
  const ed = getEditor()
  if (!ed) {
    URL.revokeObjectURL(tempUrl)
    return
  }

  // Show the image immediately with the local blob URL
  if (insertPos !== undefined) {
    ed.chain()
      .focus()
      .insertContentAt(insertPos, { type: 'image', attrs: { src: tempUrl } })
      .run()
  } else {
    ed.chain().focus().setImage({ src: tempUrl }).run()
  }

  try {
    const realUrl = await uploadImageFile(file, documentId)
    if (!realUrl) throw new Error('Upload returned no URL')

    // Swap blob URL → CDN URL in the document
    const current = getEditor()
    if (current) {
      let swapped = false
      current.state.doc.descendants((node, pos) => {
        if (swapped) return false
        if (node.type.name === 'image' && node.attrs.src === tempUrl) {
          const tr = current.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            src: realUrl,
          })
          current.view.dispatch(tr)
          swapped = true
          return false
        }
        return true
      })
    }
  } catch {
    // Remove the broken placeholder image
    const current = getEditor()
    if (current) {
      let removed = false
      current.state.doc.descendants((node, pos) => {
        if (removed) return false
        if (node.type.name === 'image' && node.attrs.src === tempUrl) {
          const tr = current.state.tr.delete(pos, pos + node.nodeSize)
          current.view.dispatch(tr)
          removed = true
          return false
        }
        return true
      })
    }
    onError()
  } finally {
    URL.revokeObjectURL(tempUrl)
  }
}
```

- [ ] **Step 4: Point the component's call site at the new module (interim)**

In `DescriptionEditor.tsx`:
- Delete the inline `async function insertImageWithUpload(...)` block (original lines ~156-230) and its doc comment.
- Add import: `import { insertImageWithUpload } from '@/lib/editor/insert-image-with-upload'`.
- In the existing `enqueueImageUpload` `useCallback`, change the call from passing `imageUploadFailedMsg` as the last arg to passing an `onError` callback:

Replace:
```ts
      insertImageWithUpload(
        file,
        documentId,
        () => editorRef.current,
        insertPos,
        imageUploadFailedMsg
      ).finally(() => {
```
with:
```ts
      insertImageWithUpload(
        file,
        documentId,
        () => editorRef.current,
        insertPos,
        () => toast.error(imageUploadFailedMsg)
      ).finally(() => {
```

(This is interim — Task 3 moves the whole `enqueueImageUpload` into the hook.)

- [ ] **Step 5: Run tests + tsc**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/editor/ && npx tsc --noEmit`
Expected: jest PASS (25 tests now), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/insert-image-with-upload.ts __tests__/editor/insert-image-with-upload.test.ts "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
git commit -m "refactor: extract insertImageWithUpload as UI-free module [LUM-211]"
```

---

## Task 3: Extract `useImageUploads` hook with `trackUpload`

**Files:**
- Create: `app/workspace/[workspaceUrl]/hooks/useImageUploads.ts`
- Test: `__tests__/hooks/useImageUploads.test.tsx`
- Modify: `DescriptionEditor.tsx` (replace inline upload state + `enqueueImageUpload` with the hook; route `onBlur` through `runOrDeferCommit`)

- [ ] **Step 1: Write the failing test**

Create `__tests__/hooks/useImageUploads.test.tsx`:

```tsx
import { renderHook, act, waitFor } from '@testing-library/react'
import { useImageUploads } from '@/app/workspace/[workspaceUrl]/hooks/useImageUploads'
import { insertImageWithUpload } from '@/lib/editor/insert-image-with-upload'
import { toast } from 'sonner'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/lib/editor/insert-image-with-upload', () => ({
  insertImageWithUpload: jest.fn(),
}))

const mockedInsert = insertImageWithUpload as jest.MockedFunction<
  typeof insertImageWithUpload
>
const mockedToastError = toast.error as jest.MockedFunction<typeof toast.error>

function pngOfSize(bytes: number): File {
  const f = new File(['x'], 'p', { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

function setup(documentId = 'doc1') {
  const editorRef = { current: null }
  return renderHook(() => useImageUploads({ editorRef, documentId }))
}

beforeEach(() => jest.clearAllMocks())

it('rejects an oversized file with a toast and does not upload', () => {
  mockedInsert.mockResolvedValue(undefined)
  const { result } = setup()
  act(() => {
    result.current.enqueueImageUpload(pngOfSize(20 * 1024 * 1024))
  })
  expect(mockedToastError).toHaveBeenCalledWith('task.imageTooLarge')
  expect(mockedInsert).not.toHaveBeenCalled()
})

it('rejects a disallowed type with a toast and does not upload', () => {
  mockedInsert.mockResolvedValue(undefined)
  const { result } = setup()
  const bmp = new File(['x'], 'p', { type: 'image/bmp' })
  act(() => {
    result.current.enqueueImageUpload(bmp)
  })
  expect(mockedToastError).toHaveBeenCalledWith('task.imageInvalidType')
  expect(mockedInsert).not.toHaveBeenCalled()
})

it('enqueues a valid file through insertImageWithUpload', () => {
  mockedInsert.mockResolvedValue(undefined)
  const { result } = setup()
  act(() => {
    result.current.enqueueImageUpload(pngOfSize(1024))
  })
  expect(mockedInsert).toHaveBeenCalledTimes(1)
})

it('runs the commit immediately when no uploads are in flight', () => {
  const { result } = setup()
  const commit = jest.fn()
  act(() => {
    result.current.runOrDeferCommit(commit)
  })
  expect(commit).toHaveBeenCalledTimes(1)
})

it('defers the commit until an in-flight upload settles', async () => {
  let resolveUpload: () => void = () => {}
  mockedInsert.mockImplementation(
    () => new Promise<void>(r => { resolveUpload = () => r() })
  )
  const { result } = setup()
  const commit = jest.fn()

  act(() => {
    result.current.enqueueImageUpload(pngOfSize(1024))
  })
  act(() => {
    result.current.runOrDeferCommit(commit)
  })
  expect(commit).not.toHaveBeenCalled() // still pending

  await act(async () => {
    resolveUpload()
  })
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/hooks/useImageUploads.test.tsx`
Expected: FAIL — cannot find module `useImageUploads`.

- [ ] **Step 3: Create the hook**

Create `app/workspace/[workspaceUrl]/hooks/useImageUploads.ts`:

```ts
import { useCallback, useRef, type MutableRefObject } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/core'
import { validateImageFile } from '@/lib/editor/image-upload'
import { insertImageWithUpload } from '@/lib/editor/insert-image-with-upload'

interface UseImageUploadsArgs {
  editorRef: MutableRefObject<Editor | null>
  documentId: string | undefined
}

interface UseImageUploadsResult {
  /** Validate + enqueue an upload. Stable across documentId/message changes so
   *  the editor's once-built handlePaste never calls a stale version. */
  enqueueImageUpload: (file: File, insertPos?: number) => void
  /** Run `commit` now, or defer it until all in-flight uploads settle. */
  runOrDeferCommit: (commit: () => void) => void
}

export function useImageUploads({
  editorRef,
  documentId,
}: UseImageUploadsArgs): UseImageUploadsResult {
  const intl = useIntl()
  const imageUploadFailedMsg = intl.formatMessage({
    id: 'task.imageUploadFailed',
  })
  const imageTooLargeMsg = intl.formatMessage({ id: 'task.imageTooLarge' })
  const imageInvalidTypeMsg = intl.formatMessage({
    id: 'task.imageInvalidType',
  })

  // Track in-flight uploads so we can delay a commit until all are settled.
  const pendingUploadsRef = useRef(0)
  const pendingCommitRef = useRef<(() => void) | null>(null)

  // The single place that counts an in-flight upload and runs a deferred
  // commit once the count returns to zero.
  const trackUpload = useCallback((promise: Promise<void>) => {
    pendingUploadsRef.current++
    promise.finally(() => {
      pendingUploadsRef.current--
      if (pendingUploadsRef.current === 0 && pendingCommitRef.current) {
        pendingCommitRef.current()
        pendingCommitRef.current = null
      }
    })
  }, [])

  const enqueueImpl = useCallback(
    (file: File, insertPos?: number) => {
      const check = validateImageFile(file)
      if (!check.ok) {
        toast.error(
          check.reason === 'size' ? imageTooLargeMsg : imageInvalidTypeMsg
        )
        return
      }
      trackUpload(
        insertImageWithUpload(
          file,
          documentId,
          () => editorRef.current,
          insertPos,
          () => toast.error(imageUploadFailedMsg)
        )
      )
    },
    [
      documentId,
      imageUploadFailedMsg,
      imageTooLargeMsg,
      imageInvalidTypeMsg,
      trackUpload,
      editorRef,
    ]
  )

  // Keep the latest impl in a ref and return a referentially-stable wrapper so
  // the editor's frozen handlePaste always reaches the current closure.
  const enqueueImplRef = useRef(enqueueImpl)
  enqueueImplRef.current = enqueueImpl
  const enqueueImageUpload = useCallback(
    (file: File, insertPos?: number) => enqueueImplRef.current(file, insertPos),
    []
  )

  const runOrDeferCommit = useCallback((commit: () => void) => {
    if (pendingUploadsRef.current > 0) {
      pendingCommitRef.current = commit
    } else {
      commit()
    }
  }, [])

  return { enqueueImageUpload, runOrDeferCommit }
}
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/hooks/useImageUploads.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the hook into the component**

In `DescriptionEditor.tsx`:

1. Add import: `import { useImageUploads } from '../hooks/useImageUploads'` (sibling `hooks/` dir).
2. **Delete** these now-hook-owned declarations from the component body:
   - the three `imageUpload*Msg`/`imageTooLargeMsg`/`imageInvalidTypeMsg` `intl.formatMessage` calls (original lines ~255-261)
   - `const pendingUploadsRef = useRef(0)` and `const pendingCommitRef = useRef<...>(null)` (original lines ~271-272)
   - `const enqueueImageUploadRef = useRef<...>(() => {})` (original lines ~275-277)
   - the entire `enqueueImageUpload` `useCallback` (original lines ~462-487)
   - the `useEffect` that mirrors `enqueueImageUploadRef.current = enqueueImageUpload` (original lines ~491-493)
3. **Add**, immediately after `editorRef` is declared (it must exist before `useEditor` and before this call):
```ts
  const { enqueueImageUpload, runOrDeferCommit } = useImageUploads({
    editorRef,
    documentId,
  })
```
4. In `editorProps.handlePaste`, replace `enqueueImageUploadRef.current(img)` with `enqueueImageUpload(img)`.
5. In `onBlur`, replace the pending-uploads branch:

Replace:
```ts
      const commit = () => {
        const html = editor.isEmpty ? null : editor.getHTML()
        onCommit(html)
      }
      if (pendingUploadsRef.current > 0) {
        pendingCommitRef.current = commit
      } else {
        commit()
      }
```
with:
```ts
      runOrDeferCommit(() => {
        const html = editor.isEmpty ? null : editor.getHTML()
        onCommit(html)
      })
```
6. The drop effect (`onDrop` → `enqueueImageUpload(img, insertPos)`) and `handleImageFileChange` (`enqueueImageUpload(file)`) already call `enqueueImageUpload` — they now resolve to the hook's stable function. Leave their bodies unchanged; their `useEffect`/`useCallback` dependency arrays still list `enqueueImageUpload` (now stable).

- [ ] **Step 6: Run full suite + tsc**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/editor/ __tests__/hooks/useImageUploads.test.tsx && npx tsc --noEmit`
Expected: jest PASS, tsc clean. (`onBlur` no longer references the deleted refs; confirm no `pendingUploadsRef`/`pendingCommitRef`/`enqueueImageUploadRef` remain in the component: `grep -n "pendingUploadsRef\|pendingCommitRef\|enqueueImageUploadRef" "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"` → no matches.)

- [ ] **Step 7: Commit**

```bash
git add "app/workspace/[workspaceUrl]/hooks/useImageUploads.ts" __tests__/hooks/useImageUploads.test.tsx "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
git commit -m "refactor: extract useImageUploads hook + trackUpload helper [LUM-211]"
```

---

## Task 4: Extract `useTocSync` hook + move `TocItem`

**Files:**
- Create: `app/workspace/[workspaceUrl]/hooks/useTocSync.ts`
- Test: `__tests__/hooks/useTocSync.test.tsx`
- Modify: `DescriptionEditor.tsx` (move `TocItem` out, re-export it, call the hook)

- [ ] **Step 1: Write the failing test**

Create `__tests__/hooks/useTocSync.test.tsx`. jsdom can't measure scroll geometry, so the test covers the wiring the hook owns: with `tocScrollRoot = null` (the no-geometry branch) the hook emits the storage items with the **first** heading active and `[]` when storage is empty. (The geometry math is covered by the untouched `__tests__/editor/toc-active.test.ts`.)

```tsx
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useTocSync, type TocItem } from '@/app/workspace/[workspaceUrl]/hooks/useTocSync'

/** Minimal editor stub exposing only tableOfContents storage. */
function editorWithToc(content: unknown) {
  return {
    storage: { tableOfContents: { content } },
  } as unknown as import('@tiptap/core').Editor
}

function renderToc(editor: unknown, onTocUpdate: (items: TocItem[]) => void) {
  return renderHook(() => {
    const onTocUpdateRef = useRef(onTocUpdate)
    onTocUpdateRef.current = onTocUpdate
    const tocScrollRootRef = useRef<HTMLElement | null>(null)
    const emitTocRef = useRef<() => void>(() => {})
    useTocSync({
      editor: editor as import('@tiptap/core').Editor | null,
      tocEnabled: true,
      tocScrollRoot: null,
      onTocUpdate,
      onTocUpdateRef,
      tocScrollRootRef,
      emitTocRef,
    })
    return { emitTocRef }
  })
}

it('emits [] when the TOC storage is empty', () => {
  const onTocUpdate = jest.fn()
  renderToc(editorWithToc([]), onTocUpdate)
  expect(onTocUpdate).toHaveBeenLastCalledWith([])
})

it('marks the first heading active when there is no scroll root', () => {
  const onTocUpdate = jest.fn()
  renderToc(
    editorWithToc([
      { id: 'a', level: 1, textContent: 'Intro', itemIndex: 1 },
      { id: 'b', level: 2, textContent: 'Details', itemIndex: 2 },
    ]),
    onTocUpdate
  )
  const items = onTocUpdate.mock.calls.at(-1)?.[0] as TocItem[]
  expect(items).toHaveLength(2)
  expect(items[0]).toMatchObject({ id: 'a', isActive: true })
  expect(items[1]).toMatchObject({ id: 'b', isActive: false })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/hooks/useTocSync.test.tsx`
Expected: FAIL — cannot find module `useTocSync`.

- [ ] **Step 3: Create the hook**

Create `app/workspace/[workspaceUrl]/hooks/useTocSync.ts`. The body is the component's TOC effect (original lines ~509-612) moved verbatim, reading the passed-in refs. `TocItem` is defined and exported here (it moves out of the component). The hook also owns syncing `onTocUpdateRef`/`tocScrollRootRef` from the passed props via effects, so the component no longer needs those mirror effects.

```ts
import { useEffect, type MutableRefObject } from 'react'
import type { Editor } from '@tiptap/core'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { computeActiveTocIndex } from '@/lib/editor/toc-active'

export type TocItem = {
  id: string
  level: number
  textContent: string
  isActive: boolean
  itemIndex: number
}

interface UseTocSyncArgs {
  editor: Editor | null
  tocEnabled: boolean
  tocScrollRoot: HTMLElement | null | undefined
  onTocUpdate: ((items: TocItem[]) => void) | undefined
  /** Refs owned by the component because the once-built TableOfContents
   *  extension config reads them; the hook keeps them current + assigns emit. */
  onTocUpdateRef: MutableRefObject<((items: TocItem[]) => void) | undefined>
  tocScrollRootRef: MutableRefObject<HTMLElement | null | undefined>
  emitTocRef: MutableRefObject<() => void>
}

export function useTocSync({
  editor,
  tocEnabled,
  tocScrollRoot,
  onTocUpdate,
  onTocUpdateRef,
  tocScrollRootRef,
  emitTocRef,
}: UseTocSyncArgs): void {
  // Keep the extension-facing refs current.
  useEffect(() => {
    onTocUpdateRef.current = onTocUpdate
  }, [onTocUpdate, onTocUpdateRef])
  useEffect(() => {
    tocScrollRootRef.current = tocScrollRoot
  }, [tocScrollRoot, tocScrollRootRef])

  useEffect(() => {
    if (!tocEnabled || !editor) return

    const ACTIVE_OFFSET = 80 // px below container top that still counts as "at the top"

    const elCache = new Map<string, HTMLElement>()
    const resolveOffsetTop = (root: HTMLElement, id: string): number | null => {
      const cached = elCache.get(id)
      if (cached && cached.isConnected) return cached.offsetTop
      const el = root.querySelector(
        `[data-toc-id="${id}"]`
      ) as HTMLElement | null
      if (!el) {
        elCache.delete(id)
        return null
      }
      elCache.set(id, el)
      return el.offsetTop
    }

    const emit = () => {
      const tocStorage = editor.storage.tableOfContents as
        | { content?: TableOfContentData }
        | undefined
      const items = tocStorage?.content ?? []
      if (!items.length) {
        onTocUpdateRef.current?.([])
        return
      }

      const root = tocScrollRootRef.current
      const activeIdx = root
        ? computeActiveTocIndex(
            items.map(item => ({
              offsetTop: resolveOffsetTop(root, item.id),
            })),
            {
              scrollTop: root.scrollTop,
              clientHeight: root.clientHeight,
              scrollHeight: root.scrollHeight,
            },
            ACTIVE_OFFSET
          )
        : 0

      onTocUpdateRef.current?.(
        items.map((item, i) => ({
          id: item.id,
          level: item.level,
          textContent: item.textContent,
          isActive: i === activeIdx,
          itemIndex: item.itemIndex,
        }))
      )
    }

    emitTocRef.current = emit

    const tocStorage = editor.storage.tableOfContents as
      | { scrollHandler?: () => void }
      | undefined
    if (typeof tocStorage?.scrollHandler === 'function') {
      window.removeEventListener('scroll', tocStorage.scrollHandler)
    }

    if (!tocScrollRoot) {
      emit()
      return
    }

    let rafId: number | null = null
    const onScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        emit()
      })
    }

    tocScrollRoot.addEventListener('scroll', onScroll, { passive: true })
    emit()

    return () => {
      tocScrollRoot.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [
    editor,
    tocEnabled,
    tocScrollRoot,
    onTocUpdateRef,
    tocScrollRootRef,
    emitTocRef,
  ])
}
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/hooks/useTocSync.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the hook into the component + move/re-export `TocItem`**

In `DescriptionEditor.tsx`:
1. **Delete** the local `export type TocItem = {...}` block (original lines ~109-115).
2. Add a re-export so existing importers (`DocumentToc.tsx`, `DocumentEditorPage.tsx` import `TocItem` from `../DescriptionEditor`) keep working, plus the hook import:
```ts
import { useTocSync, type TocItem } from '../hooks/useTocSync'
export type { TocItem }
```
3. **Delete** the two mirror effects now owned by the hook:
   - `useEffect(() => { onTocUpdateRef.current = onTocUpdate }, [onTocUpdate])` (original lines ~291-293)
   - `useEffect(() => { tocScrollRootRef.current = tocScrollRoot }, [tocScrollRoot])` (original lines ~297-299)
   Keep the `onTocUpdateRef`, `tocScrollRootRef`, `emitTocRef` **declarations** (still needed by the once-built extension config and the value-change effect).
4. **Delete** the entire TOC `useEffect` (original lines ~509-612).
5. **Add**, after `editorRef` sync effect (the hook needs `editor`, `tocEnabled`, `tocScrollRoot`):
```ts
  useTocSync({
    editor,
    tocEnabled,
    tocScrollRoot,
    onTocUpdate,
    onTocUpdateRef,
    tocScrollRootRef,
    emitTocRef,
  })
```
6. Leave untouched: `const tocEnabled = !!onTocUpdate`, the `TableOfContents.configure({ scrollParent: () => tocScrollRootRef.current ?? window, onUpdate: () => emitTocRef.current() })` in the extensions array, and the value-change effect's `emitTocRef.current()` call (line ~692).

- [ ] **Step 6: Run full suite + tsc**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/editor/ __tests__/hooks/ && npx tsc --noEmit`
Expected: jest PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add "app/workspace/[workspaceUrl]/hooks/useTocSync.ts" __tests__/hooks/useTocSync.test.tsx "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
git commit -m "refactor: extract useTocSync hook [LUM-211]"
```

---

## Task 5: Final verification + cleanup

**Files:** `DescriptionEditor.tsx` (read-through only, minor cleanup if needed)

- [ ] **Step 1: Confirm no orphaned imports/symbols**

Run:
```bash
cd .worktrees/LUM-211-split-description-editor
grep -nE "^import (Mention|\{ mergeAttributes|\{ TableOfContents|\{ computeActiveTocIndex|\{ validateImageFile|\{ uploadImageFile)" "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
```
Expected: only imports still genuinely used remain (`TableOfContents` is still used in the extensions array; `Mention`, `mergeAttributes`, `validateImageFile`, `uploadImageFile`, `computeActiveTocIndex`, `TableOfContentData`, `buildMentionSuggestion`-unrelated should be gone if no longer referenced). Remove any import with zero references. Re-run tsc after any removal.

- [ ] **Step 2: Full editor + hooks suite + whole-project tsc**

Run: `cd .worktrees/LUM-211-split-description-editor && npx jest __tests__/editor/ __tests__/hooks/ && npx tsc --noEmit`
Expected: all green, tsc clean (0 errors).

- [ ] **Step 3: Lint the touched files**

Run: `cd .worktrees/LUM-211-split-description-editor && npx eslint "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx" "app/workspace/[workspaceUrl]/hooks/useImageUploads.ts" "app/workspace/[workspaceUrl]/hooks/useTocSync.ts" lib/editor/nodes/mention-with-type.ts lib/editor/insert-image-with-upload.ts`
Expected: no new errors (warnings tolerated per the repo's warn-level config).

- [ ] **Step 4: Sanity-check line count drop**

Run: `cd .worktrees/LUM-211-split-description-editor && wc -l "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"`
Expected: substantially under the original 896 (roughly ~450-500). This is a sanity check, not a hard gate.

- [ ] **Step 5: Final commit (if Step 1 removed anything)**

```bash
git add "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
git commit -m "chore: drop orphaned imports after DescriptionEditor split [LUM-211]"
```

---

## Self-Review Notes

- **Spec coverage:** mention module (Task 1), insert-image module + onError (Task 2), useImageUploads + trackUpload + runOrDeferCommit (Task 3), useTocSync + TocItem move (Task 4), final wiring/verify (Task 5). All four spec units + the UI-free and behavior-preservation constraints are covered.
- **trackUpload semantics preserved:** increment → `.finally` decrement → run deferred commit at 0, identical to the original inline `.finally`.
- **`TocItem` blast radius:** zero — re-exported from the component so `DocumentToc.tsx` / `DocumentEditorPage.tsx` are untouched.
- **Coverage boundary (honest):** the image-swap-success ProseMirror traversal and scroll-driven TOC active highlighting are not unit-tested (jsdom limits); covered by `tsc` + the unchanged `toc-active.test.ts` + per-unit tests. No full tiptap-in-jsdom integration test is added.
- **Gotchas:** jest cwd inside worktree; `tsc --noEmit` is the only check for `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`; async deferral test uses `waitFor`.
