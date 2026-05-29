/** @jest-environment node */
import { resolveProjectIdByRef, resolveBoundProjectId } from '@/cli/src/lib/resolve-project'

afterEach(() => jest.restoreAllMocks())

it('resolveProjectIdByRef matches by slug', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [{ id: 'p1', name: 'Web App' }, { id: 'p2', name: 'Backend' }] }) } as Response)
  const r = await resolveProjectIdByRef('https://x', 'tok', 'web-app')
  expect(r).toEqual({ ok: true, id: 'p1' })
})

it('resolveProjectIdByRef matches by case-insensitive name', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [{ id: 'p2', name: 'Backend' }] }) } as Response)
  const r = await resolveProjectIdByRef('https://x', 'tok', 'backend')
  expect(r).toEqual({ ok: true, id: 'p2' })
})

it('resolveProjectIdByRef errors when not found', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [{ id: 'p1', name: 'Web App' }] }) } as Response)
  const r = await resolveProjectIdByRef('https://x', 'tok', 'nope')
  expect(r.ok).toBe(false)
})

it('resolveBoundProjectId reads task.project.id', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ task: { project: { id: 'p9', name: 'X' } } }) } as Response)
  const r = await resolveBoundProjectId('https://x', 'tok', 'LUM-5')
  expect(r).toEqual({ ok: true, id: 'p9' })
})

it('resolveBoundProjectId errors when no project on the task', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ task: {} }) } as Response)
  const r = await resolveBoundProjectId('https://x', 'tok', 'LUM-5')
  expect(r.ok).toBe(false)
})
