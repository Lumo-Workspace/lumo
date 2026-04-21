'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { ChevronRight, FolderKanban, Folder, Plus } from 'lucide-react'
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar'
import { Page, ApiProject } from '../../types'
import { slugify } from '@/lib/utils/slugify'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'lumo:sidebarProjectsExpanded'

/** Extract the project slug when the URL is /workspace/:ws/project/:slug[/...]
 *  or /workspace/:ws/projects/:slug. Returns null otherwise. */
function extractProjectSlug(
  pathname: string,
  workspaceUrl: string
): string | null {
  const base = `/workspace/${workspaceUrl}`
  if (!pathname.startsWith(base)) return null
  const rest = pathname.slice(base.length)
  const singular = rest.match(/^\/project\/([^/]+)/)
  if (singular) return singular[1]!
  const plural = rest.match(/^\/projects\/([^/]+)/)
  if (plural) return plural[1]!
  return null
}

interface Props {
  currentPage: Page
  projects: ApiProject[]
  workspaceUrl: string
  onNavigate: (page: Page) => void
  /** Provided by WorkspaceApp to open the NewProjectModal directly. Optional:
   *  when absent (standalone pages), the `+ New project` row navigates to
   *  `/projects?new=1` instead so ProjectsPage can host the modal. */
  onNewProject?: (() => void) | undefined
}

export function ProjectsSidebarGroup({
  currentPage,
  projects,
  workspaceUrl,
  onNavigate,
  onNewProject,
}: Props) {
  const intl = useIntl()
  const router = useRouter()
  const pathname = usePathname()

  // Stored user preference — starts collapsed on first use.
  const [storedExpanded, setStoredExpanded] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      setStoredExpanded(raw === '1')
    } catch {
      // localStorage may be unavailable (Safari private mode, etc.)
    }
  }, [])
  const toggleStored = () => {
    setStoredExpanded(prev => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        // ignore persistence failure; in-memory state still flips
      }
      return next
    })
  }

  // Auto-expand while inside a project page; do not mutate localStorage.
  const currentSlug = extractProjectSlug(pathname, workspaceUrl)
  const isOnProjectRoute =
    currentPage === 'project-detail' || currentSlug !== null
  const expanded = storedExpanded || isOnProjectRoute

  const visibleProjects = useMemo(
    () => projects.filter(p => !p.isIdea),
    [projects]
  )

  const handleNewProject = () => {
    if (onNewProject) {
      onNewProject()
    } else {
      router.push(`/workspace/${workspaceUrl}/projects?new=1`)
    }
  }

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={
            currentPage === 'projects' || currentPage === 'project-detail'
          }
          tooltip={intl.formatMessage({ id: 'sidebar.projects' })}
          className='pl-7'
        >
          <Link
            href={`/workspace/${workspaceUrl}/projects`}
            onClick={e => {
              e.preventDefault()
              onNavigate('projects')
            }}
          >
            <FolderKanban />
            <span>{intl.formatMessage({ id: 'sidebar.projects' })}</span>
          </Link>
        </SidebarMenuButton>
        {/* Caret sits as a sibling of the link (not a descendant) so we don't
         *  nest interactive elements inside an anchor. */}
        <button
          type='button'
          onClick={toggleStored}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? intl.formatMessage({ id: 'sidebar.collapseProjects' })
              : intl.formatMessage({ id: 'sidebar.expandProjects' })
          }
          className='absolute left-1.5 top-1/2 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
        >
          <ChevronRight
            size={12}
            className={cn('transition-transform', expanded && 'rotate-90')}
          />
        </button>
      </SidebarMenuItem>

      {expanded && (
        <SidebarMenuSub>
          {visibleProjects.length === 0 ? (
            <SidebarMenuSubItem>
              <span className='block px-2 py-1 text-xs text-sidebar-foreground/50'>
                {intl.formatMessage({ id: 'sidebar.noProjects' })}
              </span>
            </SidebarMenuSubItem>
          ) : (
            visibleProjects.map(p => {
              const slug = slugify(p.name)
              const isActive = slug === currentSlug
              return (
                <SidebarMenuSubItem key={p.id}>
                  <SidebarMenuSubButton asChild isActive={isActive}>
                    <Link href={`/workspace/${workspaceUrl}/project/${slug}`}>
                      <Folder size={12} className='shrink-0' />
                      <span>{p.name}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })
          )}

          <SidebarMenuSubItem>
            <button
              type='button'
              onClick={handleNewProject}
              className='flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            >
              <Plus size={12} className='shrink-0' />
              <span>{intl.formatMessage({ id: 'sidebar.newProject' })}</span>
            </button>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      )}
    </>
  )
}
