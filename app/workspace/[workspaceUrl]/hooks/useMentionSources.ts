'use client'

import { useMemo } from 'react'
import { mentionSearchClient } from '@/lib/api-client'
import { membersToMentionItems } from '../components/mention-types'
import type { WorkspaceMemberInfo } from '../types'
import type { MentionSources } from '@/types/mention'

/**
 * 把已加载的成员 + 统一实体搜索收成单一 mentionSources prop。
 * 调用方传入 workspace 已有的 members(各面已能拿到),实体走服务端搜索。
 * 无成员上下文的面传 [],人分区为空、实体仍可搜。
 */
export function useMentionSources(
  members: WorkspaceMemberInfo[]
): MentionSources {
  return useMemo(
    () => ({
      members: membersToMentionItems(members),
      searchEntities: (query: string) => mentionSearchClient.search(query, 5),
    }),
    [members]
  )
}
