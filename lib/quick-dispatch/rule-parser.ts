import type { Mention, QuickAction, ParseResult } from './types'

type Status = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export const STATUS_KEYWORDS: Record<string, Status> = {
  完成: 'DONE',
  done: 'DONE',
  搞定: 'DONE',
  关闭: 'DONE',
  close: 'DONE',
  进行中: 'IN_PROGRESS',
  doing: 'IN_PROGRESS',
  开始: 'IN_PROGRESS',
  start: 'IN_PROGRESS',
  开工: 'IN_PROGRESS',
  评审: 'IN_REVIEW',
  review: 'IN_REVIEW',
  提审: 'IN_REVIEW',
  待办: 'TODO',
  todo: 'TODO',
  回退: 'TODO',
  reopen: 'TODO',
}

export const PRIORITY_KEYWORDS: Record<string, Priority> = {
  P0: 'URGENT',
  紧急: 'URGENT',
  urgent: 'URGENT',
  P1: 'HIGH',
  高: 'HIGH',
  high: 'HIGH',
  P2: 'MEDIUM',
  中: 'MEDIUM',
  medium: 'MEDIUM',
  P3: 'LOW',
  低: 'LOW',
  low: 'LOW',
}

const CREATE_KEYWORDS = ['创建', '新建', 'add', 'create']

function splitSegments(text: string): string[] {
  return text
    .split(/[,，;；]/)
    .map(s => s.trim())
    .filter(Boolean)
}

function findMentionsInSegment(
  segment: string,
  mentions: Mention[]
): Mention[] {
  return mentions.filter(m => {
    const mentionText = getMentionText(m)
    return segment.includes(mentionText)
  })
}

function getMentionText(mention: Mention): string {
  switch (mention.type) {
    case 'task':
      return mention.identifier
    case 'project':
      return mention.name
    case 'member':
      return mention.name
  }
}

function matchesKeyword(text: string, keyword: string): boolean {
  if (/^[a-zA-Z0-9]+$/.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
  }
  return text.toLowerCase().includes(keyword.toLowerCase())
}

function findKeyword<T extends string>(
  segment: string,
  keywords: Record<string, T>
): T | null {
  for (const [keyword, value] of Object.entries(keywords)) {
    if (matchesKeyword(segment, keyword)) {
      return value
    }
  }
  return null
}

function hasCreateKeyword(segment: string): boolean {
  return CREATE_KEYWORDS.some(kw => matchesKeyword(segment, kw))
}

function extractCreateTitle(segment: string, mentions: Mention[]): string {
  let title = segment

  // Remove create keywords
  for (const kw of CREATE_KEYWORDS) {
    title = title.replace(new RegExp(kw, 'gi'), '')
  }

  // Remove mention texts
  for (const m of mentions) {
    const mentionText = getMentionText(m)
    const escaped = mentionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(escaped, 'g'), '')
  }

  // Remove priority keywords
  for (const kw of Object.keys(PRIORITY_KEYWORDS)) {
    title = title.replace(new RegExp(kw, 'gi'), '')
  }

  // Remove status keywords
  for (const kw of Object.keys(STATUS_KEYWORDS)) {
    title = title.replace(new RegExp(kw, 'gi'), '')
  }

  // Clean up whitespace and common punctuation artifacts
  title = title.replace(/[@#]/g, '').trim()
  title = title.replace(/\s+/g, ' ').trim()

  return title
}

export function parseQuickDispatch(
  text: string,
  mentions: Mention[]
): ParseResult {
  const segments = splitSegments(text)
  const actions: QuickAction[] = []
  const unparsedSegments: string[] = []

  for (const segment of segments) {
    const segmentMentions = findMentionsInSegment(segment, mentions)
    const taskMentions = segmentMentions.filter(m => m.type === 'task')
    const memberMentions = segmentMentions.filter(m => m.type === 'member')
    const projectMentions = segmentMentions.filter(m => m.type === 'project')

    const status = findKeyword(segment, STATUS_KEYWORDS)
    const priority = findKeyword(segment, PRIORITY_KEYWORDS)
    const isCreate = hasCreateKeyword(segment)

    if (isCreate) {
      // Create action
      const title = extractCreateTitle(segment, segmentMentions)
      const project =
        projectMentions.length > 0
          ? (projectMentions[0] as Extract<Mention, { type: 'project' }>)
          : null
      const assignee =
        memberMentions.length > 0
          ? (memberMentions[0] as Extract<Mention, { type: 'member' }>)
          : null

      actions.push({
        type: 'create',
        title,
        status: status ?? 'TODO',
        priority: priority ?? 'MEDIUM',
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        assigneeActorId: assignee?.actorId ?? null,
        assigneeName: assignee?.name ?? null,
        description: '',
        dueDate: null,
        confidence: 'high',
      })
    } else if (
      taskMentions.length > 0 &&
      (status || priority || memberMentions.length > 0)
    ) {
      // Update action(s) for each task mention
      for (const task of taskMentions) {
        const t = task as Extract<Mention, { type: 'task' }>
        const fields: {
          status?: Status
          assigneeActorId?: string
          priority?: Priority
        } = {}

        if (status) {
          fields.status = status
        }
        if (priority) {
          fields.priority = priority
        }
        if (memberMentions.length > 0) {
          const member = memberMentions[0] as Extract<
            Mention,
            { type: 'member' }
          >
          fields.assigneeActorId = member.actorId
        }

        actions.push({
          type: 'update',
          taskId: t.id,
          taskIdentifier: t.identifier,
          taskTitle: t.title,
          fields,
          confidence: 'high',
        })
      }
    } else {
      unparsedSegments.push(segment)
    }
  }

  return {
    actions,
    unparsed: unparsedSegments.join(', '),
    needsConfirmation: actions.length > 1,
  }
}
