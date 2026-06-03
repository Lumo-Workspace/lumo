'use client'

import { useEffect } from 'react'
import { slugify } from '@/lib/utils/slugify'
import type { ApiProject, Page } from '../types'
import { pathToPage } from '../utils'

interface Options {
  workspaceUrl: string
  /** Current Next.js route — used to react to navigation that originates
   * outside our `navigateTo` (e.g. browser back/forward, deep-linked load). */
  pathname: string
  projects: ApiProject[]
  selectedProject: ApiProject | null
  setCurrentPage: (page: Page) => void
  setSelectedProject: (p: ApiProject | null) => void
  setSelectedDocumentId: (id: string | null) => void
}

/**
 * Owns the bidirectional URL ↔ in-memory navigation state for the workspace
 * shell. Three concerns, all wired here so `WorkspaceApp` doesn't have to
 * carry the bookkeeping:
 *
 *   1. `pathname` change → recompute `currentPage` (component is reused
 *      across Next.js routes within `/workspace/[workspaceUrl]/...`).
 *   2. Browser back/forward (`popstate`) → recompute `currentPage`,
 *      `selectedProject`, `selectedDocumentId` from the new URL.
 *   3. Bare `/workspace/[url]` → soft-redirect to `/workspace/[url]/my-tasks`
 *      so refresh lands on a usable page.
 *   4. `selectedProject` resolution from the current `pathname` — covers both
 *      deep-links/refresh and in-app sidebar navigation (a plain `<Link>` that
 *      only pushes the URL and never sets `selectedProject` itself).
 */
export function useWorkspaceUrlSync({
  workspaceUrl,
  pathname,
  projects,
  selectedProject,
  setCurrentPage,
  setSelectedProject,
  setSelectedDocumentId,
}: Options) {
  // Sync currentPage when Next.js route changes (component reused across routes).
  useEffect(() => {
    const { page } = pathToPage(pathname, workspaceUrl)
    setCurrentPage(page)
  }, [pathname, workspaceUrl, setCurrentPage])

  // Browser back/forward — pull all derived state from the new URL.
  useEffect(() => {
    const onPopState = () => {
      const { page, projectSlug } = pathToPage(
        window.location.pathname,
        workspaceUrl
      )
      setCurrentPage(page)
      if (page === 'project-detail' && projectSlug) {
        const match = projects.find(p => slugify(p.name) === projectSlug)
        if (match) setSelectedProject(match)
      }
      if (page === 'document-editor' && projectSlug) {
        setSelectedDocumentId(projectSlug)
      } else if (page !== 'document-editor') {
        setSelectedDocumentId(null)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [
    workspaceUrl,
    projects,
    setCurrentPage,
    setSelectedProject,
    setSelectedDocumentId,
  ])

  // Bare /workspace/[url] → /workspace/[url]/my-tasks.
  useEffect(() => {
    const base = `/workspace/${workspaceUrl}`
    if (
      window.location.pathname === base ||
      window.location.pathname === `${base}/`
    ) {
      window.history.replaceState(null, '', `${base}/my-tasks`)
    }
  }, [workspaceUrl])

  // Resolve `selectedProject` from the current pathname. Reacts to every URL
  // and projects-list change, so it covers deep-links/refresh AND in-app
  // navigation: the sidebar renders each project as a plain Next `<Link>` that
  // only pushes `/projects/<slug>` without calling `navigateTo`, so nothing
  // else sets `selectedProject`. Without this, a soft-navigation to a project
  // leaves `selectedProject` null and `WorkspacePageRouter` renders blank.
  useEffect(() => {
    const { page, projectSlug } = pathToPage(pathname, workspaceUrl)
    if (page !== 'project-detail' || !projectSlug || projects.length === 0) {
      return
    }
    const match = projects.find(p => slugify(p.name) === projectSlug)
    // Skip when already resolved — the `selectedProject` dependency re-runs
    // this effect after we set it, and the id check then no-ops (no loop).
    if (match && match.id !== selectedProject?.id) {
      setSelectedProject(match)
    }
  }, [pathname, workspaceUrl, projects, selectedProject, setSelectedProject])
}
