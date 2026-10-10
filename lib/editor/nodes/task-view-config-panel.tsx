import { useIntl } from 'react-intl'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useProjects } from '@/app/workspace/[workspaceUrl]/hooks/useProjects'
import { useTags } from '@/app/workspace/[workspaceUrl]/hooks/useTags'
import { useMembers } from '@/app/workspace/[workspaceUrl]/hooks/useMembers'
import { useWorkspaceMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones'
import { statusLabel } from '@/app/workspace/[workspaceUrl]/utils/taskStatus'
import { PRIORITY_CONFIG } from '@/app/workspace/[workspaceUrl]/components/fields/shared'
import type { ApiPriority } from '@/app/workspace/[workspaceUrl]/types'
import {
  FilterCheckboxGroup,
  type FilterOption,
} from './task-view-filter-group'
import type {
  TaskViewConfig,
  TaskViewGroupBy,
  TaskViewMode,
} from './task-view-config'

const STATUS_ORDER = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const
const PRIORITY_ORDER: ApiPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']
const GROUP_BY_ORDER: TaskViewGroupBy[] = [
  'none',
  'status',
  'project',
  'milestone',
]
const VIEW_ORDER: TaskViewMode[] = ['list', 'kanban']

interface TaskViewConfigPanelProps {
  config: TaskViewConfig
  onChange: (next: TaskViewConfig) => void
}

export function TaskViewConfigPanel({
  config,
  onChange,
}: TaskViewConfigPanelProps) {
  const intl = useIntl()
  const { projects } = useProjects()
  const { tags } = useTags()
  const { milestones } = useWorkspaceMilestones()
  const { members } = useMembers()

  const f = config.filters
  const setFilter = (key: keyof TaskViewConfig['filters'], next: string[]) =>
    onChange({
      ...config,
      filters: { ...config.filters, [key]: next.length ? next : undefined },
    })

  const statusOptions: FilterOption[] = STATUS_ORDER.map(s => ({
    value: s,
    label: statusLabel(intl, s),
  }))
  const priorityOptions: FilterOption[] = PRIORITY_ORDER.map(p => ({
    value: p,
    label: PRIORITY_CONFIG[p].label,
  }))
  const projectOptions: FilterOption[] = projects.map(p => ({
    value: p.id,
    label: p.name,
  }))
  const milestoneOptions: FilterOption[] = milestones.map(m => ({
    value: m.id,
    label: m.name,
  }))
  const tagOptions: FilterOption[] = tags.map(t => ({
    value: t.id,
    label: t.name,
  }))
  const memberOptions: FilterOption[] = members
    .filter(m => m.actorId)
    .map(m => ({ value: m.actorId as string, label: m.name }))

  const groupByLabel = (g: TaskViewGroupBy) =>
    intl.formatMessage({
      id: `editor.taskView.groupBy.${g}`,
      defaultMessage:
        g === 'none'
          ? 'None'
          : g === 'status'
            ? 'Status'
            : g === 'project'
              ? 'Project'
              : 'Milestone',
    })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          contentEditable={false}
          onMouseDown={e => e.preventDefault()}
          className='h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground'
          aria-label={intl.formatMessage({
            id: 'editor.taskView.configure',
            defaultMessage: 'Configure task view',
          })}
        >
          <SlidersHorizontal size={13} />
          {intl.formatMessage({
            id: 'editor.taskView.configure',
            defaultMessage: 'Configure task view',
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='max-h-[28rem] w-64 space-y-3 overflow-y-auto p-3'
        contentEditable={false}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='space-y-1'>
          <p className='px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({
              id: 'editor.taskView.viewLabel',
              defaultMessage: 'View',
            })}
          </p>
          <div className='flex flex-wrap gap-1'>
            {VIEW_ORDER.map(v => (
              <Button
                key={v}
                type='button'
                size='sm'
                variant={config.view === v ? 'default' : 'outline'}
                className='h-6 px-2 text-xs'
                onClick={() => onChange({ ...config, view: v })}
              >
                {intl.formatMessage({
                  id: `editor.taskView.view.${v}`,
                  defaultMessage: v === 'list' ? 'List' : 'Kanban',
                })}
              </Button>
            ))}
          </div>
        </div>

        <div className='space-y-1'>
          <p className='px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({
              id: 'editor.taskView.groupByLabel',
              defaultMessage: 'Group by',
            })}
          </p>
          <div className='flex flex-wrap gap-1'>
            {GROUP_BY_ORDER.map(g => (
              <Button
                key={g}
                type='button'
                size='sm'
                variant={config.groupBy === g ? 'default' : 'outline'}
                className='h-6 px-2 text-xs'
                onClick={() => onChange({ ...config, groupBy: g })}
              >
                {groupByLabel(g)}
              </Button>
            ))}
          </div>
        </div>

        <FilterCheckboxGroup
          title={intl.formatMessage({
            id: 'editor.taskView.filter.project',
            defaultMessage: 'Projects',
          })}
          options={projectOptions}
          selected={f.projectIds ?? []}
          onChange={n => setFilter('projectIds', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({
            id: 'editor.taskView.filter.milestone',
            defaultMessage: 'Milestones',
          })}
          options={milestoneOptions}
          selected={f.milestoneIds ?? []}
          onChange={n => setFilter('milestoneIds', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({
            id: 'editor.taskView.filter.status',
            defaultMessage: 'Status',
          })}
          options={statusOptions}
          selected={f.statuses ?? []}
          onChange={n => setFilter('statuses', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({
            id: 'editor.taskView.filter.priority',
            defaultMessage: 'Priority',
          })}
          options={priorityOptions}
          selected={f.priorities ?? []}
          onChange={n => setFilter('priorities', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({
            id: 'editor.taskView.filter.tag',
            defaultMessage: 'Tags',
          })}
          options={tagOptions}
          selected={f.tagIds ?? []}
          onChange={n => setFilter('tagIds', n)}
        />
        <FilterCheckboxGroup
          title={intl.formatMessage({
            id: 'editor.taskView.filter.assignee',
            defaultMessage: 'Assignee',
          })}
          options={memberOptions}
          selected={f.assigneeActorIds ?? []}
          onChange={n => setFilter('assigneeActorIds', n)}
        />
      </PopoverContent>
    </Popover>
  )
}
