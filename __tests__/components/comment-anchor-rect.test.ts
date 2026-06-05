import { selectionAnchorRect } from '@/app/workspace/[workspaceUrl]/components/document/comments/comment-anchor-rect'

it('anchors at the selection start, extending to the selection end bottom', () => {
  const coordsAtPos = (pos: number) =>
    pos === 5
      ? { top: 100, bottom: 116, left: 40, right: 60 }
      : { top: 140, bottom: 156, left: 200, right: 220 }

  expect(selectionAnchorRect(coordsAtPos, 5, 9)).toEqual({
    top: 100,
    bottom: 156,
    left: 40,
  })
})

it('handles a collapsed selection (from === to)', () => {
  const coordsAtPos = () => ({ top: 10, bottom: 26, left: 5, right: 5 })
  expect(selectionAnchorRect(coordsAtPos, 3, 3)).toEqual({
    top: 10,
    bottom: 26,
    left: 5,
  })
})
