'use client'

import { useIntl } from 'react-intl'
import {
  Brain,
  Flag,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const PROJECT_TABS = [
  'project',
  'milestones',
  'tasks',
  'memory',
] as const
export type ProjectTabKey = (typeof PROJECT_TABS)[number]

/**
 * One icon per tab, picked to stay clear of the vocabulary the workspace nav
 * already spends: `File`/`FileEdit` are Documents and Drafts. `Brain` is reused deliberately — it is already
 * the Memory surface's own icon.
 */
const TAB_ICONS: Record<ProjectTabKey, LucideIcon> = {
  project: LayoutDashboard,
  milestones: Flag,
  tasks: ListChecks,
  memory: Brain,
}

/**
 * Tab nav — a segmented control: one recessed track with the current tab
 * raised out of it. The four tabs are a closed set of views onto the same
 * project, and a track says "pick one of these" in a way four loose buttons
 * don't. The panels stay with the parent, which renders only the active one.
 */
export function ProjectDetailTabs({
  value,
  onValueChange,
}: {
  value: ProjectTabKey
  onValueChange: (tab: ProjectTabKey) => void
}) {
  const intl = useIntl()
  return (
    <Tabs
      value={value}
      onValueChange={v => onValueChange(v as ProjectTabKey)}
      className='mt-4 shrink-0 px-4 md:px-8'
    >
      <TabsList>
        {PROJECT_TABS.map(t => {
          const Icon = TAB_ICONS[t]
          return (
            <TabsTrigger key={t} value={t} className='gap-1.5'>
              <Icon className='size-3.5 shrink-0' aria-hidden />
              {intl.formatMessage({ id: `project.tab.${t}` })}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
