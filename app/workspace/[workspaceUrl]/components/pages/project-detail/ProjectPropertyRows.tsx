'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Plus,
  GitBranch,
  Star,
  X,
  Loader2,
  Check,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGithubRepos } from '../../../hooks/useGithubRepos'
import { useProjectRepositories } from '../../../hooks/useProjectRepositories'
import { ApiRepository, WorkspaceMemberInfo } from '../../../types'
import { OwnerSelect, FIELD_TRIGGER_CLS } from '../../fields'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { PropertyRow } from './PropertyRow'

interface ProjectPropertyRowsProps {
  projectId: string
  /** WorkspaceMember id of the current owner, or null. */
  ownerId: string | null
  /** Linked repositories as the project response carried them. */
  repositories: ApiRepository[] | undefined
  members: WorkspaceMemberInfo[]
  workspaceUrl: string
  onOwnerChange: (ownerId: string | null) => void
}

/**
 * The Properties / Repos rows under the project title.
 *
 * Laid out as label-and-value rows rather than a right-hand sidebar: the Project
 * page reads top to bottom as a document, and a floating properties column would
 * pull the eye out of that flow before the description has been read.
 */
export function ProjectPropertyRows({
  projectId,
  ownerId,
  repositories: initialRepositories,
  members,
  workspaceUrl,
  onOwnerChange,
}: ProjectPropertyRowsProps) {
  const intl = useIntl()
  const [pickerOpen, setPickerOpen] = useState(false)

  const { repositories, linking, link, setDefault, unlink } =
    useProjectRepositories(projectId, initialRepositories)

  // Available repos load (and stay cached) only while the picker is open.
  const {
    repos: availableRepos,
    loading: reposLoading,
    connected: githubConnected,
  } = useGithubRepos(workspaceUrl, pickerOpen)

  const linkedFullNames = new Set(repositories.map(r => r.fullName))

  const handleAddRepo = async (fullName: string) => {
    if (linkedFullNames.has(fullName)) return
    if (await link(fullName)) setPickerOpen(false)
  }

  return (
    <div className='flex flex-col'>
      <PropertyRow label={intl.formatMessage({ id: 'project.properties' })}>
        <OwnerSelect
          value={ownerId}
          onChange={onOwnerChange}
          members={members.filter(
            (m): m is WorkspaceMemberInfo & { actorId: string } =>
              m.actorId !== null
          )}
          triggerClassName={cn(FIELD_TRIGGER_CLS, 'h-7 text-caption')}
          unassignedLabel={intl.formatMessage({ id: 'project.noOwner' })}
          tooltipText={intl.formatMessage({ id: 'project.ownerTooltip' })}
        />
      </PropertyRow>

      <PropertyRow label={intl.formatMessage({ id: 'project.repositories' })}>
        {repositories.map(repo => (
          <span
            key={repo.id}
            className='group inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1'
          >
            <GitBranch size={12} className='shrink-0 text-muted-foreground' />
            <span className='font-mono text-caption text-foreground'>
              {repo.fullName}
            </span>
            {repo.isDefault && (
              <span className='rounded-sm bg-muted px-1 text-caption leading-none text-muted-foreground'>
                {intl.formatMessage({ id: 'project.default' })}
              </span>
            )}
            <span className='inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100'>
              <a
                href={`https://github.com/${repo.fullName}`}
                target='_blank'
                rel='noopener noreferrer'
                className='text-muted-foreground hover:text-foreground'
                title={intl.formatMessage({ id: 'project.openOnGithub' })}
              >
                <ExternalLink size={11} />
              </a>
              {!repo.isDefault && (
                <button
                  onClick={() => setDefault(repo.id)}
                  className='text-muted-foreground hover:text-foreground'
                  title={intl.formatMessage({ id: 'project.setAsDefault' })}
                >
                  <Star size={11} />
                </button>
              )}
              <button
                onClick={() => unlink(repo.id)}
                className='text-muted-foreground hover:text-danger'
                title={intl.formatMessage({ id: 'project.removeRepo' })}
              >
                <X size={11} />
              </button>
            </span>
          </span>
        ))}

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'>
              <Plus size={11} />
              {intl.formatMessage({ id: 'project.addRepository' })}
            </button>
          </PopoverTrigger>
          <PopoverContent className='w-64 p-0' align='start' side='bottom'>
            {reposLoading ? (
              <div className='flex items-center justify-center gap-2 py-6 text-caption text-muted-foreground'>
                <Loader2 size={13} className='animate-spin' />
                {intl.formatMessage({ id: 'project.loadingRepos' })}
              </div>
            ) : githubConnected === false ? (
              <div className='space-y-1 px-3 py-4 text-center text-caption text-muted-foreground'>
                <p>
                  {intl.formatMessage({ id: 'project.githubNotConnected' })}
                </p>
                <p>
                  {intl.formatMessage({ id: 'project.goTo' })}{' '}
                  <a
                    href={`/workspace/${workspaceUrl}/settings`}
                    className='underline'
                  >
                    {intl.formatMessage({ id: 'project.settings' })}
                  </a>{' '}
                  {intl.formatMessage({ id: 'project.toConnectGithub' })}
                </p>
              </div>
            ) : (
              <Command>
                <CommandInput
                  placeholder={intl.formatMessage({
                    id: 'project.searchRepos',
                  })}
                  className='h-8 text-caption'
                />
                <CommandList>
                  <CommandEmpty className='py-4 text-center text-caption text-muted-foreground'>
                    {intl.formatMessage({ id: 'project.noReposFound' })}
                  </CommandEmpty>
                  <CommandGroup>
                    {availableRepos.map(repo => {
                      const isLinked = linkedFullNames.has(repo.fullName)
                      const isAdding = linking === repo.fullName
                      return (
                        <CommandItem
                          key={repo.fullName}
                          value={repo.fullName}
                          onSelect={() => handleAddRepo(repo.fullName)}
                          disabled={isLinked}
                          className='flex items-center gap-2 text-caption'
                        >
                          {isAdding ? (
                            <Loader2
                              size={12}
                              className='shrink-0 animate-spin'
                            />
                          ) : isLinked ? (
                            <Check
                              size={12}
                              className='shrink-0 text-success-text'
                            />
                          ) : (
                            <GitBranch
                              size={12}
                              className='shrink-0 text-muted-foreground'
                            />
                          )}
                          <div className='min-w-0 flex-1'>
                            <div className='truncate'>
                              {repo.fullName.split('/')[1]}
                            </div>
                            <div className='truncate font-mono text-muted-foreground'>
                              {repo.fullName}
                            </div>
                          </div>
                          {repo.private && (
                            <span className='shrink-0 text-caption text-muted-foreground'>
                              {intl.formatMessage({ id: 'project.private' })}
                            </span>
                          )}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </PopoverContent>
        </Popover>
      </PropertyRow>
    </div>
  )
}
