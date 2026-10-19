'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { ChevronRight, FolderKanban, Plus, GripVertical } from 'lucide-react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
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
import { projectsClient } from '@/lib/api-client'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const STORAGE_KEY = 'lumo:sidebarProjectsExpanded'

/** Extract the project slug when the URL is /workspace/:ws/projects/:slug[/...].
 *  Returns null otherwise. */
function extractProjectSlug(
  pathname: string,
  workspaceUrl: string
): string | null {
  const base = `/workspace/${workspaceUrl}`
  if (!pathname.startsWith(base)) return null
  const rest = pathname.slice(base.length)
  const plural = rest.match(/^\/projects\/([^/]+)/)
  if (plural) return plural[1]!
  return null
}

interface Props {
  currentPage: Page
  projects: ApiProject[]
  setProjects: Dispatch<SetStateAction<ApiProject[]>>
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
  setProjects,
  workspaceUrl,
  onNavigate,
  onNewProject,
}: Props) {
  const intl = useIntl()
  const router = useRouter()
  const pathname = usePathname()

  // Stored user preference — starts collapsed on first use.
  // `mounted` gates the icon swap until after the localStorage read. Without
  // it, the first client render shows FolderKanban (storedExpanded=false),
  // then the useEffect flips storedExpanded to true and the transition-opacity
  // classes animate the folder out and the caret in — a visible flash on any
  // full remount (e.g. navigating from a standalone page into WorkspaceApp).
  const [storedExpanded, setStoredExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      setStoredExpanded(raw === '1')
    } catch {
      // localStorage may be unavailable (Safari private mode, etc.)
    }
    setMounted(true)
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
  const visibleIds = useMemo(
    () => visibleProjects.map(p => p.id),
    [visibleProjects]
  )

  const handleNewProject = () => {
    if (onNewProject) {
      onNewProject()
    } else {
      router.push(`/workspace/${workspaceUrl}/projects?new=1`)
    }
  }

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  // Pointer activation distance mirrors the Kanban board (5px) so small
  // clicks on the grip still navigate-free; keyboard sensor is enabled for
  // accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const fromIndex = visibleIds.indexOf(String(active.id))
    const toIndex = visibleIds.indexOf(String(over.id))
    if (fromIndex < 0 || toIndex < 0) return

    const newVisible = arrayMove(visibleProjects, fromIndex, toIndex)
    const newVisibleIds = newVisible.map(p => p.id)

    // Snapshot for revert on failure; reorder the ENTIRE projects array so
    // the full list (including any isIdea projects) keeps its invariant of
    // "visible first in user order, then idea drafts". The Provider's
    // cache-sync effect persists the new order — no direct writeCache here
    // (ProjectsProvider is the sole writer of CACHE_KEY.projects).
    const prevProjects = projects
    const ideaProjects = projects.filter(p => p.isIdea)
    const nextProjects = [...newVisible, ...ideaProjects]

    setProjects(nextProjects)

    try {
      await projectsClient.reorder(newVisibleIds)
      // Server will publish `projects-reordered` via Pusher; the Provider
      // re-applies the order idempotently, so no double-write here.
    } catch {
      // Revert optimistic update on failure.
      setProjects(prevProjects)
      toast.error(intl.formatMessage({ id: 'sidebar.reorderFailed' }))
    }
  }

  return (
    <>
      <SidebarMenuItem className='group/projrow'>
        <SidebarMenuButton
          asChild
          isActive={currentPage === 'projects'}
          tooltip={intl.formatMessage({ id: 'sidebar.projects' })}
          className='pr-8'
        >
          <Link
            href={`/workspace/${workspaceUrl}/projects`}
            onClick={e => {
              e.preventDefault()
              onNavigate('projects')
            }}
          >
            <FolderKanban
              className={cn(
                'transition-opacity',
                // Hide the folder icon whenever the caret takes its slot:
                // on row-hover, or whenever the list is expanded. Before
                // mount, keep it hidden so we don't flash it while the
                // localStorage-driven `storedExpanded` hasn't resolved yet.
                !mounted || expanded
                  ? 'opacity-0'
                  : 'group-hover/projrow:opacity-0'
              )}
            />
            <span>{intl.formatMessage({ id: 'sidebar.projects' })}</span>
          </Link>
        </SidebarMenuButton>
        {/* Caret overlays the folder icon's slot — sibling of the link so we
         *  don't nest interactive elements inside an anchor. */}
        <button
          type='button'
          onClick={toggleStored}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? intl.formatMessage({ id: 'sidebar.collapseProjects' })
              : intl.formatMessage({ id: 'sidebar.expandProjects' })
          }
          className={cn(
            'absolute left-2 top-1/2 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-sidebar-foreground/70 transition-opacity hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            // Hidden until mount so we avoid the FolderKanban → Caret flash
            // when `storedExpanded` resolves to true on first paint.
            !mounted
              ? 'opacity-0'
              : expanded
                ? 'opacity-100'
                : 'opacity-0 group-hover/projrow:opacity-100'
          )}
        >
          <ChevronRight
            size={14}
            className={cn('transition-transform', expanded && 'rotate-90')}
          />
        </button>
        {/* `+ New project` — shown on row-hover, never steals the row click. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              onClick={handleNewProject}
              aria-label={intl.formatMessage({ id: 'sidebar.newProject' })}
              className='absolute right-1.5 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-sidebar-foreground/70 opacity-0 transition-opacity hover:bg-sidebar-accent/50 hover:text-sidebar-foreground group-hover/projrow:opacity-100'
            >
              <Plus size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({ id: 'sidebar.newProject' })}
          </TooltipContent>
        </Tooltip>
      </SidebarMenuItem>

      {expanded && (
        <SidebarMenuSub className='mr-0 pr-0'>
          {visibleProjects.length === 0 ? (
            <SidebarMenuSubItem>
              <span className='block px-2 py-1 text-caption text-sidebar-foreground/50'>
                {intl.formatMessage({ id: 'sidebar.noProjects' })}
              </span>
            </SidebarMenuSubItem>
          ) : (
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SortableContext
                items={visibleIds}
                strategy={verticalListSortingStrategy}
              >
                {visibleProjects.map(p => {
                  const slug = slugify(p.name)
                  const isActive = slug === currentSlug
                  return (
                    <SortableProjectItem
                      key={p.id}
                      project={p}
                      slug={slug}
                      isActive={isActive}
                      workspaceUrl={workspaceUrl}
                      reorderLabel={intl.formatMessage({
                        id: 'sidebar.reorderProject',
                      })}
                    />
                  )
                })}
              </SortableContext>
            </DndContext>
          )}
        </SidebarMenuSub>
      )}
    </>
  )
}

// ── Sortable item ────────────────────────────────────────────────────────────

interface SortableProjectItemProps {
  project: ApiProject
  slug: string
  isActive: boolean
  workspaceUrl: string
  reorderLabel: string
}

function SortableProjectItem({
  project,
  slug,
  isActive,
  workspaceUrl,
  reorderLabel,
}: SortableProjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <SidebarMenuSubItem
      ref={setNodeRef}
      style={style}
      className='group/project relative'
    >
      <SidebarMenuSubButton asChild isActive={isActive} className='w-full pr-6'>
        <Link href={`/workspace/${workspaceUrl}/projects/${slug}`}>
          <span>{project.name}</span>
        </Link>
      </SidebarMenuSubButton>
      {/* Grip sits outside the Link so the drag handle isn't an interactive
       *  descendant of an anchor; shown on hover for a lighter UI. */}
      <button
        type='button'
        aria-label={reorderLabel}
        {...attributes}
        {...listeners}
        className='absolute right-1 top-1/2 flex size-5 -translate-y-1/2 cursor-grab items-center justify-center rounded-sm text-sidebar-foreground/40 opacity-0 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground group-hover/project:opacity-100 active:cursor-grabbing'
      >
        <GripVertical size={12} />
      </button>
    </SidebarMenuSubItem>
  )
}
