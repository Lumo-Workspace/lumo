'use client'

import { useState, useCallback, useEffect } from 'react'
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
import { apiFetch } from '@/lib/api-client'
import { ApiProject, ApiRepository, WorkspaceMemberInfo } from '../../../types'
import { ReviewerSelect, FIELD_TRIGGER_CLS } from '../../fields'
import { ProjectRiskOverrideCard } from '../../summary/ProjectRiskOverrideCard'
import { DescriptionEditor } from '../../DescriptionEditor'
import { TypographyH3 } from '@/components/ui/typography'
import { IDEA_BADGE_CLS } from '../../../constants'
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

interface ProjectOverviewTabProps {
  project: ApiProject
  members: WorkspaceMemberInfo[]
  workspaceUrl: string
  workspaceRiskDefaults: {
    riskOverdueRatio: number
    riskStalledDays: number
    riskStalledMinCount: number
    riskAgentFailRatio: number
    riskStalePrDays: number
    riskThroughputDrop: number
  } | null
  onUpdateProject: (
    id: string,
    data: {
      name?: string
      description?: string
      ownerId?: string | null
    }
  ) => Promise<void>
}

export function ProjectOverviewTab({
  project,
  members,
  workspaceUrl,
  workspaceRiskDefaults,
  onUpdateProject,
}: ProjectOverviewTabProps) {
  const intl = useIntl()

  // ── Repositories state ────────────────────────────────────────────────────
  const [repositories, setRepositories] = useState<ApiRepository[]>(
    project.repositories ?? []
  )
  // Sync when parent hydrates repositories from the API (standalone page flow)
  useEffect(() => {
    if (project.repositories) setRepositories(project.repositories)
  }, [project.repositories])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [availableRepos, setAvailableRepos] = useState<
    { fullName: string; private: boolean }[]
  >([])
  const [reposLoading, setReposLoading] = useState(false)
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const [addingRepo, setAddingRepo] = useState<string | null>(null)

  // Fetch available repos from GitHub when picker opens
  useEffect(() => {
    if (!pickerOpen) return
    setReposLoading(true)
    apiFetch<{ repos?: { fullName: string; private: boolean }[] }>(
      `/api/github/repos?workspaceUrl=${workspaceUrl}`
    )
      .then(data => {
        if (data.repos) {
          setAvailableRepos(data.repos)
          setGithubConnected(true)
        } else {
          setGithubConnected(false)
        }
      })
      .catch(() => setGithubConnected(false))
      .finally(() => setReposLoading(false))
  }, [pickerOpen, workspaceUrl])

  const linkedFullNames = new Set(repositories.map(r => r.fullName))

  const handleAddRepo = useCallback(
    async (fullName: string) => {
      if (linkedFullNames.has(fullName)) return
      setAddingRepo(fullName)
      try {
        const data = await apiFetch<{ repository: ApiRepository }>(
          `/api/projects/${project.id}/repositories`,
          {
            method: 'POST',
            body: { fullName },
          }
        )
        setRepositories(prev => [...prev, data.repository])
        setPickerOpen(false)
      } finally {
        setAddingRepo(null)
      }
    },

    [project.id, linkedFullNames]
  )

  const handleSetDefault = useCallback(
    async (repoId: string) => {
      try {
        await apiFetch(`/api/projects/${project.id}/repositories/${repoId}`, {
          method: 'PATCH',
          body: { isDefault: true },
        })
        setRepositories(prev =>
          prev.map(r => ({ ...r, isDefault: r.id === repoId }))
        )
      } catch {
        // ignore
      }
    },
    [project.id]
  )

  const handleRemoveRepo = useCallback(
    async (repoId: string) => {
      try {
        await apiFetch(`/api/projects/${project.id}/repositories/${repoId}`, {
          method: 'DELETE',
        })
        setRepositories(prev => prev.filter(r => r.id !== repoId))
      } catch {
        // ignore
      }
    },
    [project.id]
  )

  return (
    <div className='flex-1 overflow-y-auto'>
      <div className='px-4 md:px-8 py-8'>
        {/* Title */}
        <div className='flex items-center gap-1.5 mb-8'>
          <TypographyH3
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
            className='outline-none cursor-text focus:outline-none'
          >
            {project.name}
          </TypographyH3>
          {project.isIdea && (
            <span className={IDEA_BADGE_CLS}>
              {intl.formatMessage({
                id: 'project.draft',
                defaultMessage: 'Draft',
              })}
            </span>
          )}
        </div>

        {/* Two-column layout */}
        <div className='flex gap-10'>
          {/* ── Left: Description ── */}
          <div className='flex-1 min-w-0'>
            <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3'>
              {intl.formatMessage({
                id: 'project.description',
                defaultMessage: 'Description',
              })}
            </p>
            <DescriptionEditor
              key={project.id}
              value={project.description}
              onCommit={html => {
                onUpdateProject(project.id, { description: html ?? '' })
              }}
              placeholder={intl.formatMessage({
                id: 'project.descriptionPlaceholder',
                defaultMessage: 'Add a description…',
              })}
              members={members}
              documentId={project.id}
            />
          </div>

          {/* ── Right: Properties sidebar ── */}
          <div className='w-56 shrink-0 space-y-6'>
            {/* Lead */}
            <div className='space-y-2'>
              <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
                {intl.formatMessage({
                  id: 'project.lead',
                  defaultMessage: 'Lead',
                })}
              </p>
              <ReviewerSelect
                value={project.ownerId ?? null}
                onChange={v =>
                  onUpdateProject(project.id, { ownerId: v })
                }
                members={members.filter(
                  (m): m is WorkspaceMemberInfo & { actorId: string } =>
                    m.actorId !== null
                )}
                triggerClassName={cn(FIELD_TRIGGER_CLS, 'h-7 text-xs w-full')}
              />
            </div>

            {/* Risk thresholds override */}
            {workspaceRiskDefaults && (
              <ProjectRiskOverrideCard
                projectId={project.id}
                workspaceDefaults={workspaceRiskDefaults}
                initialOverrides={{
                  riskOverdueRatio: project.riskOverdueRatio ?? null,
                  riskStalledDays: project.riskStalledDays ?? null,
                  riskStalledMinCount: project.riskStalledMinCount ?? null,
                  riskAgentFailRatio: project.riskAgentFailRatio ?? null,
                  riskStalePrDays: project.riskStalePrDays ?? null,
                  riskThroughputDrop: project.riskThroughputDrop ?? null,
                }}
              />
            )}

            {/* Repositories */}
            <div className='space-y-2'>
              <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
                {intl.formatMessage({
                  id: 'project.repositories',
                  defaultMessage: 'Repositories',
                })}
              </p>

              {/* Listed repos */}
              {repositories.length > 0 && (
                <ul className='space-y-1.5'>
                  {repositories.map(repo => (
                    <li
                      key={repo.id}
                      className='group flex items-start gap-2 rounded-md px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800'
                    >
                      <GitBranch
                        size={13}
                        className='text-zinc-400 shrink-0 mt-0.5'
                      />
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-1.5 h-[18px]'>
                          <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate'>
                            {repo.name}
                          </span>
                          {repo.isDefault && (
                            <span className='inline-flex items-center h-[18px] px-1 rounded text-[10px] leading-none bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 shrink-0'>
                              {intl.formatMessage({
                                id: 'project.default',
                                defaultMessage: 'Default',
                              })}
                            </span>
                          )}
                        </div>
                        <span className='text-[11px] text-zinc-400 dark:text-zinc-500 font-mono truncate block'>
                          {repo.fullName}
                        </span>
                      </div>
                      <div className='flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0'>
                        <a
                          href={`https://github.com/${repo.fullName}`}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                          title={intl.formatMessage({
                            id: 'project.openOnGithub',
                            defaultMessage: 'Open on GitHub',
                          })}
                        >
                          <ExternalLink size={11} />
                        </a>
                        {!repo.isDefault && (
                          <button
                            onClick={() => handleSetDefault(repo.id)}
                            className='p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                            title={intl.formatMessage({
                              id: 'project.setAsDefault',
                              defaultMessage: 'Set as default',
                            })}
                          >
                            <Star size={11} />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveRepo(repo.id)}
                          className='p-0.5 text-zinc-400 hover:text-red-500'
                          title={intl.formatMessage({
                            id: 'project.removeRepo',
                            defaultMessage: 'Remove',
                          })}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Add repository picker */}
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button className='flex items-center gap-1.5 w-full h-7 px-2 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors'>
                    <Plus size={11} />
                    {intl.formatMessage({
                      id: 'project.addRepository',
                      defaultMessage: 'Add repository',
                    })}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className='w-64 p-0'
                  align='start'
                  side='bottom'
                >
                  {reposLoading ? (
                    <div className='flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground'>
                      <Loader2 size={13} className='animate-spin' />
                      {intl.formatMessage({
                        id: 'project.loadingRepos',
                        defaultMessage: 'Loading repositories…',
                      })}
                    </div>
                  ) : githubConnected === false ? (
                    <div className='px-3 py-4 text-xs text-muted-foreground text-center space-y-1'>
                      <p>
                        {intl.formatMessage({
                          id: 'project.githubNotConnected',
                          defaultMessage: 'GitHub is not connected.',
                        })}
                      </p>
                      <p>
                        {intl.formatMessage({
                          id: 'project.goTo',
                          defaultMessage: 'Go to',
                        })}{' '}
                        <a
                          href={`/workspace/${workspaceUrl}/settings`}
                          className='text-blue-500 underline'
                        >
                          {intl.formatMessage({
                            id: 'project.settings',
                            defaultMessage: 'Settings',
                          })}
                        </a>{' '}
                        {intl.formatMessage({
                          id: 'project.toConnectGithub',
                          defaultMessage: 'to connect GitHub.',
                        })}
                      </p>
                    </div>
                  ) : (
                    <Command>
                      <CommandInput
                        placeholder={intl.formatMessage({
                          id: 'project.searchRepos',
                          defaultMessage: 'Search repositories…',
                        })}
                        className='text-xs h-8'
                      />
                      <CommandList>
                        <CommandEmpty className='py-4 text-xs text-center text-muted-foreground'>
                          {intl.formatMessage({
                            id: 'project.noReposFound',
                            defaultMessage: 'No repositories found.',
                          })}
                        </CommandEmpty>
                        <CommandGroup>
                          {availableRepos.map(repo => {
                            const isLinked = linkedFullNames.has(repo.fullName)
                            const isAdding = addingRepo === repo.fullName
                            return (
                              <CommandItem
                                key={repo.fullName}
                                value={repo.fullName}
                                onSelect={() => handleAddRepo(repo.fullName)}
                                disabled={isLinked}
                                className='flex items-center gap-2 text-xs'
                              >
                                {isAdding ? (
                                  <Loader2
                                    size={12}
                                    className='animate-spin shrink-0'
                                  />
                                ) : isLinked ? (
                                  <Check
                                    size={12}
                                    className='text-green-500 shrink-0'
                                  />
                                ) : (
                                  <GitBranch
                                    size={12}
                                    className='text-zinc-400 shrink-0'
                                  />
                                )}
                                <div className='flex-1 min-w-0'>
                                  <div className='truncate font-medium'>
                                    {repo.fullName.split('/')[1]}
                                  </div>
                                  <div className='truncate text-zinc-400 font-mono'>
                                    {repo.fullName}
                                  </div>
                                </div>
                                {repo.private && (
                                  <span className='text-[10px] text-zinc-400 shrink-0'>
                                    {intl.formatMessage({
                                      id: 'project.private',
                                      defaultMessage: 'private',
                                    })}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
