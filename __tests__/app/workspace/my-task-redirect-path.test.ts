import { buildMyTaskRedirectPath } from '@/app/workspace/[workspaceUrl]/utils/taskPath'

describe('buildMyTaskRedirectPath', () => {
  it('preserves the tab segment when redirecting a non-owned my-task to the projects canonical URL', () => {
    expect(
      buildMyTaskRedirectPath('lumo', 'Lumo', 'LUM-1', ['acceptance'])
    ).toBe('/workspace/lumo/projects/lumo/tasks/LUM-1/acceptance')
  })

  it('redirects to the bare canonical URL when there is no tab segment (comments default)', () => {
    expect(buildMyTaskRedirectPath('lumo', 'Lumo', 'LUM-1', undefined)).toBe(
      '/workspace/lumo/projects/lumo/tasks/LUM-1'
    )
  })

  it('treats an empty tab array as no tab — no trailing slash, no /undefined', () => {
    expect(buildMyTaskRedirectPath('lumo', 'Lumo', 'LUM-1', [])).toBe(
      '/workspace/lumo/projects/lumo/tasks/LUM-1'
    )
  })

  it('slugifies the project name into the canonical project segment', () => {
    expect(
      buildMyTaskRedirectPath('acme', 'My Project!', 'ACME-42', ['activity'])
    ).toBe('/workspace/acme/projects/my-project/tasks/ACME-42/activity')
  })

  it('passes an unknown tab slug through verbatim (the target page self-heals it)', () => {
    expect(buildMyTaskRedirectPath('lumo', 'Lumo', 'LUM-1', ['bogus'])).toBe(
      '/workspace/lumo/projects/lumo/tasks/LUM-1/bogus'
    )
  })
})
