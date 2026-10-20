import type { TaskPriorityValue } from '@/lib/task/priority'
export type Mention =
  | {
      type: 'task'
      id: string
      identifier: string
      title: string
      position: [number, number]
    }
  | { type: 'project'; id: string; name: string; position: [number, number] }
  | {
      type: 'member'
      actorId: string
      name: string
      position: [number, number]
    }

export type QuickAction =
  | {
      type: 'update'
      taskId: string
      taskIdentifier: string
      taskTitle: string
      fields: {
        status?:
          | 'BACKLOG'
          | 'TODO'
          | 'IN_PROGRESS'
          | 'IN_REVIEW'
          | 'DONE'
          | 'CANCELED'
        assigneeActorId?: string
        priority?: TaskPriorityValue
      }
      confidence: 'high' | 'medium' | 'low'
    }
  | {
      type: 'create'
      title: string
      status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
      priority: TaskPriorityValue
      projectId: string | null
      projectName: string | null
      assigneeActorId: string | null
      assigneeName: string | null
      description: string
      dueDate: string | null
      confidence: 'high' | 'medium' | 'low'
    }

export interface ParseResult {
  actions: QuickAction[]
  unparsed: string
  needsConfirmation: boolean
}
