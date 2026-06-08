export type MentionKind = 'user' | 'task' | 'sprint' | 'project' | 'milestone'

/** 实体搜索结果的 wire DTO(服务端→客户端)。人不走它(走客户端缓存)。 */
export interface MentionSearchItem {
  kind: 'task' | 'sprint' | 'project' | 'milestone'
  id: string
  label: string
  sublabel?: string
  status?: string
  href: string
}

/** 下拉项(UI 判别联合)。 */
export type MentionItem =
  | {
      kind: 'user'
      id: string
      label: string
      imageUrl: string | null
    }
  | MentionSearchItem

/** 单一 prop:人(即时)+ 实体异步搜索。 */
export interface MentionSources {
  members: Extract<MentionItem, { kind: 'user' }>[]
  searchEntities: (query: string) => Promise<MentionSearchItem[]>
}
