'use client'

import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { useNow } from '@/hooks/use-now'
import type { SignalView } from '@/lib/summaries/signal-view'
import type { StalledBlockerItem, StalePrItem } from '@/types/summary'
import { useMentionSources } from '../../../hooks/useMentionSources'
import {
  ApiProject,
  ProjectUpdateFields,
  WorkspaceMemberInfo,
} from '../../../types'
import { IDEA_BADGE_CLS } from '../../../constants'
import { DescriptionEditor } from '../../DescriptionEditorLazy'
import { TypographyH1 } from '@/components/ui/typography'
import { ProjectHealthRow } from '../../signal/ProjectHealthRow'
import { ProjectPropertyRows } from './ProjectPropertyRows'
import { ProjectLifecycleRows } from './ProjectLifecycleRows'
import { PropertyRow } from './PropertyRow'
import { ProjectMilestonesOverview } from './ProjectMilestonesOverview'
import { Skeleton } from '@/components/ui/skeleton'

interface ProjectTabProps {
  project: ApiProject
  projectSlug: string
  members: WorkspaceMemberInfo[]
  workspaceUrl: string
  /** Health signals, or null while loading / on failure. */
  view: SignalView | null
  /** The blocker lists the health row's panels render, already unpacked by the
   *  page — this component never reaches into the stats payload itself. */
  stalled: StalledBlockerItem[]
  highStakes: StalledBlockerItem[]
  stalePrs: StalePrItem[]
  statsLoading: boolean
  statsError: string | null
  onUpdateProject: (id: string, data: ProjectUpdateFields) => Promise<void>
  onOpenTask: (taskId: string) => void
  onViewAllTasks: () => void
  onViewAllMilestones: () => void
}

/**
 * The project's landing page: what it is, who owns it, whether anything is on
 * fire, and how far the milestones have got — in that order, top to bottom.
 *
 * Merges what used to be two tabs (Overview and Signal). They were answering
 * the same question — "how is this project doing" — from two pages, so reading
 * either one alone was misleading.
 *
 * Health signals are fetched by the parent, not here: the tab badge needs the
 * same numbers while this tab is unmounted, and a second fetch would let the
 * two disagree.
 */
export function ProjectTab({
  project,
  projectSlug,
  members,
  workspaceUrl,
  view,
  stalled,
  highStakes,
  stalePrs,
  statsLoading,
  statsError,
  onUpdateProject,
  onOpenTask,
  onViewAllTasks,
  onViewAllMilestones,
}: ProjectTabProps) {
  const intl = useIntl()
  const now = useNow()
  const mentionSources = useMentionSources(members)
  const healthLabel = intl.formatMessage({ id: 'project.health' })

  // LUM-1285: lifecycle edits can be refused (e.g. target before start), so
  // surface the server's reason instead of failing silently.
  const updateLifecycle = (fields: ProjectUpdateFields) => {
    onUpdateProject(project.id, fields).catch((err: unknown) => {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : intl.formatMessage({ id: 'project.updateFailed' })
      )
    })
  }

  return (
    <div className='flex-1 overflow-y-auto'>
      {/* The workspace body geometry (`px-4 md:px-8` + `max-w-[1680px]`), same
          as Sprints — not the design source's 760px column. That column
          was drawn on a 1440px canvas where it left ~81px of gutter on each side;
          carried onto a real window it turns into hundreds of pixels of dead
          space, first on the left when centred, then on the right when pinned
          left. The row layout the design specifies is preserved; only the
          measure it was drawn at gives way to the width every sibling page
          already uses. */}
      <div className='px-4 py-10 md:px-8'>
        <div className='mx-auto w-full max-w-[1680px]'>
          <div className='mb-5 flex items-center gap-1.5'>
            <TypographyH1
              key={project.id}
              contentEditable
              suppressContentEditableWarning
              onBlur={e => {
                const trimmed = e.currentTarget.textContent?.trim() ?? ''
                if (!trimmed || trimmed === project.name) {
                  e.currentTarget.textContent = project.name
                  return
                }
                onUpdateProject(project.id, { name: trimmed })
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  e.currentTarget.textContent = project.name
                  e.currentTarget.blur()
                }
              }}
              className='cursor-text outline-none focus:outline-none'
            >
              {project.name}
            </TypographyH1>
            {project.isIdea && (
              <span className={IDEA_BADGE_CLS}>
                {intl.formatMessage({ id: 'project.draft' })}
              </span>
            )}
          </div>

          <ProjectPropertyRows
            projectId={project.id}
            ownerId={project.ownerId ?? null}
            repositories={project.repositories}
            members={members}
            workspaceUrl={workspaceUrl}
            onOwnerChange={ownerId => onUpdateProject(project.id, { ownerId })}
          />

          <ProjectLifecycleRows
            status={project.status ?? 'ACTIVE'}
            startDate={project.startDate ?? null}
            targetDate={project.targetDate ?? null}
            completed={project.completed === true}
            archived={Boolean(project.archivedAt)}
            onChange={updateLifecycle}
          />

          {/* Health — the one section that can be empty-but-meaningful, so it
            keeps its label even while the stats request is in flight. */}
          <div className='mt-4'>
            {statsLoading && !view ? (
              <PropertyRow label={healthLabel}>
                <Skeleton className='h-6 w-56 rounded-full' aria-busy='true' />
              </PropertyRow>
            ) : !view ? (
              <PropertyRow label={healthLabel}>
                <span className='text-caption text-muted-foreground'>
                  {intl.formatMessage({
                    id: statsError
                      ? 'summary.reportFailed'
                      : 'signal.noSignals',
                  })}
                </span>
              </PropertyRow>
            ) : (
              <ProjectHealthRow
                label={healthLabel}
                view={view}
                stalled={stalled}
                highStakes={highStakes}
                stalePrs={stalePrs}
                now={now}
                onOpenTask={onOpenTask}
                onViewAllTasks={onViewAllTasks}
              />
            )}
          </div>

          {/* Prose is the one block that keeps the design's 760px measure. The
              rows above and below are scanned — they want the full width — but
              at 1720px the description ran ~227 characters to the line, roughly
              twice any readable measure. */}
          <div className='max-w-[760px] pt-9'>
            <p className='mb-3 text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'project.description' })}
            </p>
            <DescriptionEditor
              key={project.id}
              value={project.description}
              onCommit={html => {
                onUpdateProject(project.id, { description: html ?? '' })
              }}
              placeholder={intl.formatMessage({
                id: 'project.descriptionPlaceholder',
              })}
              mentionSources={mentionSources}
              documentId={project.id}
            />
          </div>

          <div className='pt-9'>
            <ProjectMilestonesOverview
              projectId={project.id}
              projectSlug={projectSlug}
              workspaceUrl={workspaceUrl}
              onViewAll={onViewAllMilestones}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
