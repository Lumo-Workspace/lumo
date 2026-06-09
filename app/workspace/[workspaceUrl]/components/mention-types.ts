import type { WorkspaceMemberInfo } from '../types'
import type { MentionItem } from '@/types/mention'

/** 把 workspace 成员映射成 user 下拉项;排除 agent 占位。 */
export function membersToMentionItems(
  members: WorkspaceMemberInfo[]
): Extract<MentionItem, { kind: 'user' }>[] {
  return members
    .filter(m => m.clerkId !== '__agent__')
    .map(m => ({
      kind: 'user' as const,
      id: m.clerkId,
      label: m.name,
      imageUrl: m.imageUrl,
    }))
}
