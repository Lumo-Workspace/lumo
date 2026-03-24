import type { SuggestionOptions } from '@tiptap/suggestion'
import type { WorkspaceMemberInfo, ApiTask } from '../types'
import type { MentionItem, MentionListRef } from './MentionList'

export type MentionPopupState = {
  items: MentionItem[]
  rect: DOMRect
  command: (attrs: {
    id: string
    label: string
    mentionType: string
    mentionTitle?: string
    mentionStatus?: string
  }) => void
}

export function buildMentionSuggestion(
  members: WorkspaceMemberInfo[],
  tasks: ApiTask[],
  onOpen: (state: MentionPopupState) => void,
  onUpdate: (state: MentionPopupState) => void,
  onClose: () => void,
  listRef: React.RefObject<MentionListRef | null>
): Partial<SuggestionOptions> {
  return {
    items: ({ query }): MentionItem[] => {
      const q = query.toLowerCase()

      const userItems: MentionItem[] = members
        .filter(m => m.name.toLowerCase().includes(q))
        .slice(0, 5)
        .map(m => ({
          type: 'user',
          id: m.clerkId,
          label: m.name,
          imageUrl: m.imageUrl,
        }))

      const taskItems: MentionItem[] = tasks
        .filter(
          t =>
            t.title.toLowerCase().includes(q) ||
            `${t.teamIdentifier}-${t.number}`.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .map(t => ({
          type: 'task',
          id: t.id,
          label: `${t.teamIdentifier}-${t.number}`,
          title: t.title,
          status: t.status,
        }))

      return [...userItems, ...taskItems]
    },

    render() {
      return {
        onStart(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          onOpen({
            items: props.items as MentionItem[],
            rect,
            command: props.command,
          })
        },
        onUpdate(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          onUpdate({
            items: props.items as MentionItem[],
            rect,
            command: props.command,
          })
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            onClose()
            return true
          }
          return listRef.current?.onKeyDown(props) ?? false
        },
        onExit() {
          onClose()
        },
      }
    },
  }
}
