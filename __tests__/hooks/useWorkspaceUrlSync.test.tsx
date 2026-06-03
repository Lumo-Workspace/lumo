import { renderHook } from '@testing-library/react'
import { useWorkspaceUrlSync } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceUrlSync'
import type { ApiProject } from '@/app/workspace/[workspaceUrl]/types'

const lumo = { id: 'p1', name: 'Lumo' } as unknown as ApiProject
const backend = { id: 'p2', name: 'Backend API' } as unknown as ApiProject

function makeBase() {
  return {
    workspaceUrl: 'lumo',
    projects: [lumo, backend],
    selectedProject: null as ApiProject | null,
    setCurrentPage: jest.fn(),
    setSelectedProject: jest.fn(),
    setSelectedDocumentId: jest.fn(),
  }
}

describe('useWorkspaceUrlSync', () => {
  it('resolves selectedProject from the current pathname on in-app navigation', () => {
    // Reproduces the bug: the app mounted on /my-tasks, then the user clicks a
    // project in the sidebar — a plain <Link> that only pushes the URL and
    // never sets selectedProject. The pathname flips but selectedProject stays
    // null, so WorkspacePageRouter renders blank.
    const base = makeBase()
    const { rerender } = renderHook(props => useWorkspaceUrlSync(props), {
      initialProps: { ...base, pathname: '/workspace/lumo/my-tasks' },
    })

    rerender({ ...base, pathname: '/workspace/lumo/projects/lumo' })

    expect(base.setSelectedProject).toHaveBeenCalledWith(lumo)
  })

  it('does not re-set selectedProject when it already matches the pathname slug', () => {
    const base = makeBase()
    base.selectedProject = lumo
    renderHook(props => useWorkspaceUrlSync(props), {
      initialProps: { ...base, pathname: '/workspace/lumo/projects/lumo' },
    })

    expect(base.setSelectedProject).not.toHaveBeenCalled()
  })

  it('switches selectedProject when navigating between two project pages', () => {
    const base = makeBase()
    base.selectedProject = lumo
    const { rerender } = renderHook(props => useWorkspaceUrlSync(props), {
      initialProps: { ...base, pathname: '/workspace/lumo/projects/lumo' },
    })

    rerender({ ...base, pathname: '/workspace/lumo/projects/backend-api' })

    expect(base.setSelectedProject).toHaveBeenCalledWith(backend)
  })

  it('does not resolve a project when the pathname is not a project-detail route', () => {
    const base = makeBase()
    renderHook(props => useWorkspaceUrlSync(props), {
      initialProps: { ...base, pathname: '/workspace/lumo/my-tasks' },
    })

    expect(base.setSelectedProject).not.toHaveBeenCalled()
  })
})
