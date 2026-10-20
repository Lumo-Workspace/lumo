'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { fieldTriggerProps, type FieldVariant } from './shared'
import type { ApiProject } from '../../types'

export interface ProjectSelectProps {
  value: string
  onChange: (v: string) => void
  projects: ApiProject[]
  placeholder?: string
  triggerClassName?: string
  /** LUM-1274: `ghost` = borderless inline row (task detail panel). */
  variant?: FieldVariant
}

export function ProjectSelect({
  value,
  onChange,
  projects,
  placeholder = 'Select project',
  triggerClassName,
  variant,
}: ProjectSelectProps) {
  const project = projects.find(p => p.id === value)
  return (
    <Select value={value} onValueChange={onChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            {...fieldTriggerProps(variant)}
            className={triggerClassName}
          >
            {project ? (
              <span>{project.name}</span>
            ) : (
              <span className='text-muted-foreground'>{placeholder}</span>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Project</TooltipContent>
      </Tooltip>
      <SelectContent>
        {projects.length === 0 ? (
          <SelectItem value='__empty__' disabled>
            No projects
          </SelectItem>
        ) : (
          projects.map(p => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
