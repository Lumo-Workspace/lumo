/** @jest-environment jsdom */
import {
  measureAnchorTop,
  collectOpenCommentAnchors,
  measurePendingAnchor,
} from '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-dom'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const rectAt = (top: number) =>
  ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect)

const stubRect = (el: Element, top: number) => {
  el.getBoundingClientRect = () => rectAt(top)
}

const comment = (id: string, status: 'OPEN' | 'RESOLVED' = 'OPEN'): ApiDocumentComment => ({
  id, documentId: 'd1', authorActorId: null, body: '<p>x</p>', parentId: null,
  quotedText: 'q', anchorStart: 1, anchorEnd: 2, status, isOrphaned: false,
  type: 'USER', createdAt: '2026-06-05T00:00:00Z', replies: [],
})

it('measureAnchorTop returns top of el relative to rowEl', () => {
  const row = document.createElement('div')
  const el = document.createElement('span')
  stubRect(row, 40)
  stubRect(el, 160)
  expect(measureAnchorTop(el, row)).toBe(120)
})

it('collectOpenCommentAnchors measures each OPEN comment span, skips RESOLVED', () => {
  const row = document.createElement('div')
  stubRect(row, 0)
  const dom = document.createElement('div')
  const s1 = document.createElement('span')
  s1.setAttribute('data-comment-id', 'c1')
  stubRect(s1, 90)
  dom.appendChild(s1)
  const out = collectOpenCommentAnchors(dom, row, [comment('c1'), comment('c2', 'RESOLVED')])
  expect(out).toEqual([{ id: 'c1', anchorY: 90 }])
})

it('collectOpenCommentAnchors returns Infinity for a missing (orphaned) span', () => {
  const row = document.createElement('div')
  stubRect(row, 0)
  const dom = document.createElement('div')
  const out = collectOpenCommentAnchors(dom, row, [comment('gone')])
  expect(out).toEqual([{ id: 'gone', anchorY: Number.POSITIVE_INFINITY }])
})

it('measurePendingAnchor uses coordsAtPos relative to rowEl', () => {
  const row = document.createElement('div')
  stubRect(row, 10)
  const editor = { view: { coordsAtPos: (_p: number) => ({ top: 210, bottom: 220, left: 0, right: 0 }) } }
  expect(measurePendingAnchor(editor as never, row, 5)).toBe(200)
})
