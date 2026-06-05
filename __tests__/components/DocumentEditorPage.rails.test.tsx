/** @jest-environment jsdom */
// The rich DocumentEditorPage depends on Clerk/React-Query/Tiptap providers that
// make a full jsdom mount brittle. The user-visible guarantees (no tab switcher,
// composer not at the document bottom, no overlapping cards) are covered by the
// CommentGutter tests + the no-`rightTab` grep. This asserts the layout contract
// the rails rely on: cards never overlap.
import { resolveGutterLayout } from '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout'

it('lays out two comments without overlap (rails contract)', () => {
  const tops = resolveGutterLayout(
    [
      { id: 'c1', anchorY: 0, height: 96 },
      { id: 'c2', anchorY: 40, height: 96 },
    ],
    8
  )
  expect(tops.c1).toBe(0)
  expect(tops.c2).toBe(104) // pushed below c1 (0 + 96 + 8)
})
