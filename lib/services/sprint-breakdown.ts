/**
 * Pure helpers for the sprint sidebar breakdown panels.
 *
 * Both helpers return only non-empty buckets so the UI can render
 * conditionally ("if (buckets.length)"). The ordering convention:
 *   - Priority: URGENT → HIGH → MEDIUM → LOW (severity first)
 *   - Member:   descending by total, then name A→Z as a stable tiebreaker
 *
 * "Done" means `status === 'DONE'` to match the overall sprint progress
 * metric. BACKLOG tasks are unscheduled and stay out of every bucket
 * (LUM-1057). Tasks without an assigneeActorId are intentionally skipped in
 * the member breakdown — the sprint-level progress row already covers
 * the unassigned bucket.
 */

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
type Status = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'

export interface BreakdownTask {
  priority: Priority
  status: Status
  assigneeActorId: string | null
}

export interface MemberRef {
  id: string
  name: string
  actorId: string | null
}

export interface PriorityBucket {
  priority: Priority
  done: number
  total: number
}

export interface MemberBucket<M extends MemberRef = MemberRef> {
  member: M
  done: number
  total: number
}

const PRIORITY_ORDER: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

export function priorityBreakdown(
  tasks: BreakdownTask[] | null | undefined
): PriorityBucket[] {
  const buckets = new Map<Priority, PriorityBucket>()
  for (const t of tasks ?? []) {
    if (t.status === 'BACKLOG') continue
    const b = buckets.get(t.priority) ?? {
      priority: t.priority,
      done: 0,
      total: 0,
    }
    b.total += 1
    if (t.status === 'DONE') b.done += 1
    buckets.set(t.priority, b)
  }
  return PRIORITY_ORDER.filter(p => buckets.has(p)).map(p => buckets.get(p)!)
}

export function memberBreakdown<M extends MemberRef>(
  tasks: BreakdownTask[] | null | undefined,
  members: M[] | null | undefined
): MemberBucket<M>[] {
  const byActor = new Map<string, M>()
  for (const m of members ?? []) {
    if (m.actorId) byActor.set(m.actorId, m)
  }

  const buckets = new Map<string, MemberBucket<M>>()
  for (const t of tasks ?? []) {
    if (t.status === 'BACKLOG' || !t.assigneeActorId) continue
    const member = byActor.get(t.assigneeActorId)
    if (!member) continue // Agent assignees / stale actors are skipped.
    const b = buckets.get(member.id) ?? { member, done: 0, total: 0 }
    b.total += 1
    if (t.status === 'DONE') b.done += 1
    buckets.set(member.id, b)
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.member.name.localeCompare(b.member.name)
  })
}
