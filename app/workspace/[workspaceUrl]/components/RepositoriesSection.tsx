'use client'

import {
  Plus,
  GitBranch,
  Star,
  X,
  Loader2,
  Check,
  ExternalLink,
} from 'lucide-react'
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
import type { ApiRepository } from '../types'

interface RepositoriesSectionProps {
  repositories: ApiRepository[]
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  availableRepos: { fullName: string; private: boolean }[]
  reposLoading: boolean
  githubConnected: boolean | null
  addingRepo: string | null
  linkedFullNames: Set<string>
  onAddRepo: (fullName: string) => void
  onSetDefault: (repoId: string) => void
  onRemoveRepo: (repoId: string) => void
  workspaceUrl: string
}

export function RepositoriesSection({
  repositories,
  pickerOpen,
  onPickerOpenChange,
  availableRepos,
  reposLoading,
  githubConnected,
  addingRepo,
  linkedFullNames,
  onAddRepo,
  onSetDefault,
  onRemoveRepo,
  workspaceUrl,
}: RepositoriesSectionProps) {
  return (
    <div className='space-y-2'>
      <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
        Repositories
      </p>

      {/* Listed repos */}
      {repositories.length > 0 && (
        <ul className='space-y-1.5'>
          {repositories.map(repo => (
            <li
              key={repo.id}
              className='group flex items-start gap-2 rounded-md px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800'
            >
              <GitBranch size={13} className='text-zinc-400 shrink-0 mt-0.5' />
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-1.5 h-[18px]'>
                  <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate'>
                    {repo.name}
                  </span>
                  {repo.isDefault && (
                    <span className='inline-flex items-center h-[18px] px-1 rounded text-[10px] leading-none bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 shrink-0'>
                      Default
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
                  title='Open on GitHub'
                >
                  <ExternalLink size={11} />
                </a>
                {!repo.isDefault && (
                  <button
                    onClick={() => onSetDefault(repo.id)}
                    className='p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    title='Set as default'
                  >
                    <Star size={11} />
                  </button>
                )}
                <button
                  onClick={() => onRemoveRepo(repo.id)}
                  className='p-0.5 text-zinc-400 hover:text-red-500'
                  title='Remove'
                >
                  <X size={11} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add repository picker */}
      <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
        <PopoverTrigger asChild>
          <button className='flex items-center gap-1.5 w-full h-7 px-2 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors'>
            <Plus size={11} />
            Add repository
          </button>
        </PopoverTrigger>
        <PopoverContent className='w-64 p-0' align='start' side='bottom'>
          {reposLoading ? (
            <div className='flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground'>
              <Loader2 size={13} className='animate-spin' />
              Loading repositories…
            </div>
          ) : githubConnected === false ? (
            <div className='px-3 py-4 text-xs text-muted-foreground text-center space-y-1'>
              <p>GitHub is not connected.</p>
              <p>
                Go to{' '}
                <a
                  href={`/workspace/${workspaceUrl}/settings`}
                  className='text-blue-500 underline'
                >
                  Settings
                </a>{' '}
                to connect GitHub.
              </p>
            </div>
          ) : (
            <Command>
              <CommandInput
                placeholder='Search repositories…'
                className='text-xs h-8'
              />
              <CommandList>
                <CommandEmpty className='py-4 text-xs text-center text-muted-foreground'>
                  No repositories found.
                </CommandEmpty>
                <CommandGroup>
                  {availableRepos.map(repo => {
                    const isLinked = linkedFullNames.has(repo.fullName)
                    const isAdding = addingRepo === repo.fullName
                    return (
                      <CommandItem
                        key={repo.fullName}
                        value={repo.fullName}
                        onSelect={() => onAddRepo(repo.fullName)}
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
                            private
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
  )
}
