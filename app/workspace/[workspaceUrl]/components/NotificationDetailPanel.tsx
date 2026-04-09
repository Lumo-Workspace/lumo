'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Inbox, Loader2 } from 'lucide-react'
import {
  ApiNotification,
  ApiTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import { TaskDetailPanel } from './TaskDetailPanel'

interface NotificationDetailPanelProps {
  panelLoading: boolean
  panelTask: ApiTask | null
  selectedNotification: ApiNotification | undefined
  unreadCount: number
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  onUpdate: (
    taskId: string,
    data: Partial<{
      title: string
      status: ApiStatus
      assigneeActorId: string | null
      reviewerActorId: string | null
      description: string | null
      projectId: string
      priority: ApiPriority
    }>
  ) => Promise<void>
}

export function NotificationDetailPanel({
  panelLoading,
  panelTask,
  selectedNotification,
  unreadCount,
  members,
  projects,
  onUpdate,
}: NotificationDetailPanelProps) {
  return (
    <div className='flex-1 flex flex-col overflow-hidden relative'>
      <AnimatePresence mode='wait'>
        {panelLoading ? (
          <motion.div
            key='loading'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.1 }}
            className='absolute inset-0 flex items-center justify-center'
          >
            <Loader2
              size={20}
              className='animate-spin text-zinc-300 dark:text-zinc-600'
            />
          </motion.div>
        ) : panelTask ? (
          <motion.div
            key={panelTask.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.12 }}
            className='absolute inset-0 flex flex-col'
          >
            <TaskDetailPanel
              initialTask={panelTask}
              cachedDescription={
                readCache<{ desc: string | null }>(
                  CACHE_KEY.description(panelTask.id)
                )?.desc
              }
              onDescriptionLoaded={(taskId, description) => {
                writeCache(CACHE_KEY.description(taskId), {
                  desc: description,
                })
              }}
              members={members}
              projects={projects}
              onUpdate={onUpdate}
            />
          </motion.div>
        ) : selectedNotification && !selectedNotification.taskId ? (
          <motion.div
            key='no-task'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.1 }}
            className='absolute inset-0 flex items-center justify-center text-zinc-400'
          >
            <p className='text-sm'>No task linked to this notification.</p>
          </motion.div>
        ) : (
          <motion.div
            key='empty'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.1 }}
            className='absolute inset-0 flex flex-col items-center justify-center gap-3 pb-16'
          >
            <Inbox size={32} className='text-muted-foreground/30' />
            <p className='text-sm text-muted-foreground'>
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
                : "You're all caught up"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
