/**
 * LUM-680: the Comment table is polymorphic — a comment references a Task XOR an
 * Idea via two nullable FKs. This is the app-layer half of that invariant (the
 * migration adds a matching DB CHECK for defence-in-depth): exactly one of
 * `taskId` / `ideaId` must be set. Pure and side-effect-free so it can guard
 * every create path and be unit-tested in isolation.
 *
 * Throws `{ status: 400 }` when neither or both owners are present.
 */
export function assertSingleCommentOwner(owner: {
  taskId?: string | null
  ideaId?: string | null
}): void {
  const hasTask = owner.taskId != null
  const hasIdea = owner.ideaId != null
  if (hasTask === hasIdea) {
    throw Object.assign(
      new Error('A comment must reference exactly one of a task or an idea'),
      { status: 400 }
    )
  }
}
