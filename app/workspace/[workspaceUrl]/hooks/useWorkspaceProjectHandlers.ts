'use client'

import { useCallback, Dispatch, SetStateAction } from 'react'
import type { ApiProject, Page } from '../types'
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
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useWorkspaceProjectHandlers({
  setProjects,
  setSelectedProject,
  navigateTo,
  onDeleteProjectTasks,
  setSelectedTask,
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
        defaultReviewerId: null,
        createdAt: now,
        updatedAt: now,
        _count: { tasks: 0 },
        todoCount: 0,
        inProgressCount: 0,
        inReviewCount: 0,
        doneCount: 0,
        defaultReviewer: null,
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
        defaultReviewer: null,
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
    async (
      id: string,
      data: {
        name?: string
        description?: string
        defaultReviewerId?: string | null
      }
    ) => {
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
      onDeleteProjectTasks(projectId)
      setSelectedProject(null)
      setSelectedTask((prev: unknown) => {
        const p = prev as { id?: string; projectId?: string } | null
        return p && p.projectId === projectId ? null : prev
      })
      setProjects(prev => prev.filter(p => p.id !== projectId))
      navigateTo('projects')

      await projectsClient.delete(projectId)
    },
    [
      navigateTo,
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
  }
}
