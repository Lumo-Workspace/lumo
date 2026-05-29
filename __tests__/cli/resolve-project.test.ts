/** @jest-environment node */
import { resolveBoundProjectId } from '@/cli/src/lib/resolve-project'

afterEach(() => jest.restoreAllMocks())

it('reads task.project.id from by-identifier', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ task: { project: { id: 'p9', name: 'X' } } }) } as Response)
  const r = await resolveBoundProjectId('https://x', 'tok', 'LUM-5')
  expect(r).toEqual({ ok: true, id: 'p9' })
})

it('errors when the task has no project', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ task: {} }) } as Response)
  const r = await resolveBoundProjectId('https://x', 'tok', 'LUM-5')
  expect(r.ok).toBe(false)
})

it('errors on a non-ok response (e.g. 404)', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)
  const r = await resolveBoundProjectId('https://x', 'tok', 'LUM-404')
  expect(r.ok).toBe(false)
})

it('errors on a network failure', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
  const r = await resolveBoundProjectId('https://x', 'tok', 'LUM-5')
  expect(r.ok).toBe(false)
})
