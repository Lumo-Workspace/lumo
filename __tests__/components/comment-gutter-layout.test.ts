import {
  resolveGutterLayout,
  type GutterItem,
} from '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout'

const items = (xs: Array<[string, number, number]>): GutterItem[] =>
  xs.map(([id, anchorY, height]) => ({ id, anchorY, height }))

it('returns empty map for empty input', () => {
  expect(resolveGutterLayout([], 8)).toEqual({})
})

it('keeps non-overlapping anchors at their anchorY', () => {
  const tops = resolveGutterLayout(items([['a', 0, 20], ['b', 100, 20]]), 8)
  expect(tops).toEqual({ a: 0, b: 100 })
})

it('pushes an overlapping card to prevBottom + gap', () => {
  // a: 0..50, b wants 30 but must clear 50 + gap(8) = 58
  const tops = resolveGutterLayout(items([['a', 0, 50], ['b', 30, 20]]), 8)
  expect(tops).toEqual({ a: 0, b: 58 })
})

it('sorts out-of-order input by anchorY before laying out', () => {
  const tops = resolveGutterLayout(items([['b', 100, 20], ['a', 0, 20]]), 8)
  expect(tops).toEqual({ a: 0, b: 100 })
})

it('cascades pushes across three tight anchors', () => {
  // a:0..20, b:max(10,28)=28..48, c:max(20,56)=56
  const tops = resolveGutterLayout(
    items([['a', 0, 20], ['b', 10, 20], ['c', 20, 20]]),
    8
  )
  expect(tops).toEqual({ a: 0, b: 28, c: 56 })
})
