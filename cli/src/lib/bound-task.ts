/**
 * Resolve the task a crossing-scoped command should act on (LUM-542 / LUM-769).
 *
 * Crossing routes are task-scoped (`/api/tasks/<task>/boundary-crossings/…`)
 * but the terminal addresses a crossing by its id alone, so the task comes
 * from the session binding — the same binding `lumo session attach` wrote —
 * unless the caller named one explicitly (`--task`). Failure is a value: the
 * caller prints the message and exits 1.
 */
export type BoundTaskResult =
  | { ok: true; taskIdentifier: string }
  | { ok: false; message: string }

export async function resolveBoundTask(args: {
  base: string
  headers: Record<string, string>
  /** An explicit task identifier (`--task LUM-N`) wins over the binding. */
  explicit?: string | undefined
  sessionId?: string | undefined
}): Promise<BoundTaskResult> {
  const explicit = args.explicit?.trim()
  if (explicit) return { ok: true, taskIdentifier: explicit }
  if (!args.sessionId) {
    return {
      ok: false,
      message:
        'Error: $CLAUDE_CODE_SESSION_ID is not set — run inside a session bound via `lumo session attach <LUM-N>`, or pass --task <LUM-N>.',
    }
  }
  let bound: { taskIdentifier: string | null } | null
  try {
    const res = await fetch(
      `${args.base}/api/sessions/${encodeURIComponent(args.sessionId)}`,
      { headers: args.headers }
    )
    bound = res.ok
      ? ((await res.json()) as { taskIdentifier: string | null })
      : null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Error: could not reach Lumo API (${msg})` }
  }
  if (!bound?.taskIdentifier) {
    return {
      ok: false,
      message:
        'Error: this session is not bound to a task. Run `lumo session attach <LUM-N>` first, or pass --task <LUM-N>.',
    }
  }
  return { ok: true, taskIdentifier: bound.taskIdentifier }
}
