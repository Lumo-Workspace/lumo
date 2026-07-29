'use client'

import { useIntl } from 'react-intl'
import { useNow } from '@/hooks/use-now'
import type { SignalView } from '@/lib/summaries/signal-view'
import type { TaskSummaryStats } from '@/types/summary'
import { useMentionSources } from '../../../hooks/useMentionSources'
import { ApiProject, WorkspaceMemberInfo } from '../../../types'
import { IDEA_BADGE_CLS } from '../../../constants'
import { DescriptionEditor } from '../../DescriptionEditorLazy'
import { TypographyH1 } from '@/components/ui/typography'
import { ProjectHealthRow } from '../../signal/ProjectHealthRow'
import { ProjectPropertyRows } from './ProjectPropertyRows'
import { PropertyRow } from './PropertyRow'
import { ProjectMilestonesOverview } from './ProjectMilestonesOverview'

interface ProjectTabProps {
  project: ApiProject
  projectSlug: string
  members: WorkspaceMemberInfo[]
  workspaceUrl: string
  /** Health signals, or null while loading / on failure. */
  view: SignalView | null
  stats: TaskSummaryStats | null
  statsLoading: boolean
  statsError: string | null
  onUpdateProject: (
    id: string,
    data: { name?: string; description?: string; ownerId?: string | null }
  ) => Promise<void>
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
  stats,
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

  return (
    <div className='flex-1 overflow-y-auto'>
      {/* A 760px reading column — this page is read, not scanned in columns —
          pinned to the page's standard left edge rather than centred. The design
          source centres it, but it was drawn on a 1440px canvas where that left
          only an 81px gutter; centring at a real window width grows the gutter
          without bound (~445px on a wide screen) and pushes the body far off the
          breadcrumb and tab rail above it. Left-aligning keeps the line length
          the design chose and the geometry the rest of the workspace uses. */}
      <div className='px-4 py-10 md:px-8'>
        <div className='w-full max-w-[760px]'>
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
            project={project}
            members={members}
            workspaceUrl={workspaceUrl}
            onUpdateProject={onUpdateProject}
          />

          {/* Health — the one section that can be empty-but-meaningful, so it
            keeps its label even while the stats request is in flight. */}
          <div className='mt-4'>
            {statsLoading && !view ? (
              <PropertyRow label={healthLabel}>
                <div
                  className='h-6 w-56 animate-pulse rounded-full bg-muted'
                  aria-busy='true'
                />
              </PropertyRow>
            ) : !view || !stats ? (
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
                stalled={stats.topBlockers.stalledTaskIds}
                highStakes={stats.topBlockers.highStakesTaskIds}
                stalePrs={stats.topBlockers.staleOpenPrs}
                now={now}
                onOpenTask={onOpenTask}
                onViewAllTasks={onViewAllTasks}
              />
            )}
          </div>

          <div className='pt-9'>
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
