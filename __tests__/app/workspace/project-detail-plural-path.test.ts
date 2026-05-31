import { pageToPath } from '@/app/workspace/[workspaceUrl]/utils/pageToPath'
import { pathToPage } from '@/app/workspace/[workspaceUrl]/utils/pathToPage'

/**
 * Regression guard for LUM-126: project-detail URLs are unified on the PLURAL
 * `/projects/<slug>` form, matching the milestone routes. The old singular
 * `/project/<slug>` route was removed, so nothing may emit it anymore.
 */
describe('project-detail uses the plural /projects/ path', () => {
  const ws = 'lumo'

  it('pageToPath emits /projects/<slug> for project-detail', () => {
    expect(pageToPath(ws, 'project-detail', { name: 'Lumo' })).toBe(
      `/workspace/${ws}/projects/lumo`
    )
  })

  it('pageToPath emits the bare /projects list when no project is given', () => {
    expect(pageToPath(ws, 'project-detail', null)).toBe(
      `/workspace/${ws}/projects`
    )
  })

  it('never emits the legacy singular /project/ path', () => {
    const path = pageToPath(ws, 'project-detail', { name: 'Lumo' })
    expect(path).not.toMatch(/\/project\//)
  })

  it('round-trips through pathToPage back to project-detail', () => {
    const path = pageToPath(ws, 'project-detail', { name: 'Lumo' })
    expect(pathToPage(path, ws)).toEqual({
      page: 'project-detail',
      projectSlug: 'lumo',
    })
  })
})
