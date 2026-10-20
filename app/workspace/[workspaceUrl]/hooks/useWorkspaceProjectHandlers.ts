'use client'

import { useCallback, Dispatch, SetStateAction } from 'react'
import type { ApiProject, Page, ProjectUpdateFields } from '../types'
import { projectsClient } from '@/lib/api-client'
import type { NewProjectFormData } from '../components/modals/NewProjectModal'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'

// ── Types ───────────────────────────────────────────────────────────────────

interface UseWorkspaceProjectHandlersOptions {
  setProjects: Dispatch<SetStateAction<ApiProject[]>>
  setSelectedProject: Dispatch<SetStateAction<ApiProject | null>>
  navigateTo: (page: Page, project?: ApiProject) => void
  /** Cleanup task data when deleting a project */
  onDeleteProjectTasks: (projectId: string) => void
  setSelectedTask: Dispatch<SetStateAction<unknown>>
  /** Re-fetch the project list (used to reconcile partial bulk-delete failures) */
  fetchProjects: () => Promise<void> | void
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useWorkspaceProjectHandlers({
  setProjects,
  setSelectedProject,
  navigateTo,
  onDeleteProjectTasks,
  setSelectedTask,
  fetchProjects,
}: UseWorkspaceProjectHandlersOptions) {
  const intl = useIntl()

  const handleSelectProject = useCallback(
    (p: ApiProject) => {
      navigateTo('project-detail', p)
    },
    [navigateTo]
  )

  const handleBack = useCallback(() => {
    navigateTo('projects')
  }, [navigateTo])

  const openNewProject = useCallback(
    () => true, // caller sets modal state
    []
  )

  const handleCreateProject = useCallback(
    async ({ name, description }: NewProjectFormData) => {
      const tempId = `optimistic-${Date.now()}`
      const now = new Date().toISOString()
      const optimistic: ApiProject = {
        id: tempId,
        name,
        description: description.trim() || null,
        isIdea: false,
        ownerId: null,
        createdAt: now,
        updatedAt: now,
        _count: { tasks: 0 },
        todoCount: 0,
        inProgressCount: 0,
        inReviewCount: 0,
        doneCount: 0,
        owner: null,
      }

      setProjects(prev => [optimistic, ...prev])
      navigateTo('project-detail', optimistic)

      let project: ApiProject
      try {
        const data = await projectsClient.create<{ project: ApiProject }>({
          name,
          description: description.trim() || undefined,
        })
        project = data.project
      } catch (err) {
        setProjects(prev => prev.filter(p => p.id !== tempId))
        navigateTo('projects')
        const message =
          err instanceof Error ? err.message : 'Failed to create project'
        toast.error(
          message ?? intl.formatMessage({ id: 'task.projectCreateFailed' })
        )
        throw err
      }
      const confirmed: ApiProject = {
        ...project,
        _count: { tasks: 0 },
        todoCount: 0,
        inProgressCount: 0,
        inReviewCount: 0,
        doneCount: 0,
        owner: null,
      }
      setProjects(prev => prev.map(p => (p.id === tempId ? confirmed : p)))
      setSelectedProject(prev => (prev?.id === tempId ? confirmed : prev))
      toast.success(intl.formatMessage({ id: 'task.projectCreateSuccess' }), {
        description: `${project.name}`,
      })
    },
    [setProjects, navigateTo, setSelectedProject, intl]
  )

  const handleUpdateProject = useCallback(
    async (id: string, data: ProjectUpdateFields) => {
      const { project: updated } = await projectsClient.update<{
        project: ApiProject
      }>(id, data)
      setProjects(prev =>
        prev.map(p => (p.id === id ? { ...p, ...updated } : p))
      )
      setSelectedProject(prev =>
        prev?.id === id ? { ...prev, ...updated } : prev
      )
    },
    [setProjects, setSelectedProject]
  )

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      // Await the server delete BEFORE mutating UI state. If we flipped
      // `currentPage` to 'projects' first, the WorkspaceApp page-change
      // effect would fire `fetchProjects()` while DELETE was still in-flight.
      // The fetch would return the (still-present) project and overwrite our
      // optimistic removal — leaving a ghost row in the list and, via the
      // ProjectsProvider cache-sync effect, in localStorage too.
      try {
        await projectsClient.delete(projectId)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete project'
        toast.error(message)
        throw err
      }

      // All UI updates below batch into a single render, so there's no
      // intermediate "null selectedProject on project-detail" flash.
      onDeleteProjectTasks(projectId)
      setSelectedProject(null)
      setSelectedTask((prev: unknown) => {
        const p = prev as { id?: string; projectId?: string } | null
        return p && p.projectId === projectId ? null : prev
      })
      setProjects(prev => prev.filter(p => p.id !== projectId))
      navigateTo('projects')
    },
    [
      navigateTo,
      onDeleteProjectTasks,
      setProjects,
      setSelectedProject,
      setSelectedTask,
    ]
  )

  const handleBulkDeleteProjects = useCallback(
    async (projectIds: string[]) => {
      if (projectIds.length === 0) return

      const idSet = new Set(projectIds)

      // Optimistic local cleanup
      projectIds.forEach(id => onDeleteProjectTasks(id))
      setSelectedProject(prev => (prev && idSet.has(prev.id) ? null : prev))
      setSelectedTask((prev: unknown) => {
        const t = prev as { id?: string; projectId?: string } | null
        return t && t.projectId && idSet.has(t.projectId) ? null : prev
      })
      setProjects(prev => prev.filter(p => !idSet.has(p.id)))

      const results = await Promise.allSettled(
        projectIds.map(id => projectsClient.delete(id))
      )
      const failed = results.filter(r => r.status === 'rejected').length

      if (failed > 0) {
        // Reconcile by re-fetching from the server
        await fetchProjects()
        toast.error(
          `Failed to delete ${failed} of ${projectIds.length} project${projectIds.length === 1 ? '' : 's'}`
        )
      } else {
        toast.success(
          `${projectIds.length} project${projectIds.length === 1 ? '' : 's'} deleted`
        )
      }
    },
    [
      fetchProjects,
      onDeleteProjectTasks,
      setProjects,
      setSelectedProject,
      setSelectedTask,
    ]
  )

  return {
    handleSelectProject,
    handleBack,
    openNewProject,
    handleCreateProject,
    handleUpdateProject,
    handleDeleteProject,
    handleBulkDeleteProjects,
  }
}
