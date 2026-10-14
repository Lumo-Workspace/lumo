import { taskScope } from '../src/lib/test-case-scope'

it('builds a task scope', () => {
  expect(taskScope('LUM-42')).toEqual({
    basePath: '/api/tasks/LUM-42',
    label: 'LUM-42',
    kind: 'task',
  })
})

it('encodes the identifier', () => {
  expect(taskScope('a b').basePath).toBe('/api/tasks/a%20b')
})
