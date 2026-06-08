import { taskSourcePath } from '@/app/workspace/[workspaceUrl]/utils/taskSourcePath'

describe('taskSourcePath', () => {
  it('points to my-tasks when the source is my-tasks', () => {
    expect(taskSourcePath('lumo', 'my-tasks', 'Lumo')).toBe(
      '/workspace/lumo/my-tasks'
    )
  })

  it('points to the project list (slugified) when the source is a project', () => {
    // from === null is the "came from a project" case the breadcrumb uses.
    expect(taskSourcePath('lumo', null, 'Lumo')).toBe(
      '/workspace/lumo/projects/lumo'
    )
  })

  it('slugifies a multi-word project name for the project segment', () => {
    expect(taskSourcePath('acme', 'design-system', 'My Cool Project')).toBe(
      '/workspace/acme/projects/my-cool-project'
    )
  })

  it('treats any non-"my-tasks" source as the project case', () => {
    // The breadcrumb only special-cases the literal 'my-tasks'; every other
    // `from` value (including a stale/unknown string) falls through to project.
    expect(taskSourcePath('lumo', 'something-else', 'Backend')).toBe(
      '/workspace/lumo/projects/backend'
    )
  })
})
