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

/** PR state reduced to what a task-mention chip badge needs (LUM-411). */
export type MentionPrState = 'none' | 'open' | 'merged'

/**
 * Live status (+ PR) for one task identifier — the wire DTO behind the live
 * status badge on `@LUM-N` mention chips. Lives in `types/` so the render side
 * (api-client, components) can import it without reaching into `lib/services`.
 */
export interface MentionStatusItem {
  /** Uppercased `TEAM-N` identifier (e.g. `LUM-411`). */
  identifier: string
  /** The task's CURRENT status — not the snapshot frozen into the node. */
  status: string
  pr: MentionPrState
}
