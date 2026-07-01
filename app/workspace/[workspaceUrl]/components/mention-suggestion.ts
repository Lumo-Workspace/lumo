import type { SuggestionOptions } from '@tiptap/suggestion'
import type { MentionItem, MentionSources } from '@/types/mention'
import type { MentionListRef } from './MentionList'
import type * as React from 'react'

export type MentionPopupState = {
  items: MentionItem[]
  loading: boolean
  rect: DOMRect
  command: (attrs: {
    id: string
    label: string
    mentionType: string
    mentionTitle?: string
    mentionStatus?: string
    mentionHref?: string
  }) => void
}

const DEBOUNCE_MS = 200

export function buildMentionSuggestion(
  sources: MentionSources,
  onOpen: (state: MentionPopupState) => void,
  onUpdate: (state: MentionPopupState) => void,
  onClose: () => void,
  listRef: React.RefObject<MentionListRef | null>
): Partial<SuggestionOptions> {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let searchToken = 0

  const userMatches = (query: string): MentionItem[] => {
    const q = query.toLowerCase()
    return sources.members
      .filter(m => m.label.toLowerCase().includes(q))
      .slice(0, 5)
  }

  return {
    // Trigger '@' after ANY character, not just a space or block start.
    // @tiptap/suggestion defaults to `allowedPrefixes: [' ']`, which rejects
    // '@' typed right after a non-space char. Empty editors (a fresh comment)
    // hit '@' at block start so it fired there, but description editors always
    // carry existing content, so typing '@' at the end of a word was silently
    // rejected — reading as "descriptions have no @-mention" (LUM-330 regression
    // in feel). `null` disables the prefix guard, matching Slack/Linear/GitHub.
    allowedPrefixes: null,
    items: ({ query }): MentionItem[] => userMatches(query),

    render() {
      let latestRect: DOMRect | null = null
      let latestCommand: MentionPopupState['command'] | null = null
      let latestQuery = ''

      const runSearch = () => {
        const token = ++searchToken
        const rect = latestRect
        const command = latestCommand
        if (!rect || !command) return
        sources
          .searchEntities(latestQuery)
          .then(entities => {
            if (token !== searchToken) return
            onUpdate({
              items: [...userMatches(latestQuery), ...entities],
              loading: false,
              rect,
              command,
            })
          })
          .catch(() => {
            if (token !== searchToken) return
            onUpdate({
              items: userMatches(latestQuery),
              loading: false,
              rect,
              command,
            })
          })
      }

      const schedule = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(runSearch, DEBOUNCE_MS)
      }

      return {
        onStart(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          latestRect = rect
          latestCommand = props.command
          latestQuery = props.query
          onOpen({
            items: props.items as MentionItem[],
            loading: true,
            rect,
            command: props.command,
          })
          schedule()
        },
        onUpdate(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          latestRect = rect
          latestCommand = props.command
          latestQuery = props.query
          onUpdate({
            items: props.items as MentionItem[],
            loading: true,
            rect,
            command: props.command,
          })
          schedule()
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            onClose()
            return true
          }
          return listRef.current?.onKeyDown(props) ?? false
        },
        onExit() {
          if (debounceTimer) clearTimeout(debounceTimer)
          searchToken++
          onClose()
        },
      }
    },
  }
}
