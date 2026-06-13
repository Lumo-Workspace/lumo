/** Formats a millisecond duration as `Nms` / `Ns` / `Nm` / `Nm Ss`.
 *  Shared by the per-run card (AgentRunCard) and the task-level run-time
 *  metric (delivery cards). */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem === 0 ? `${min}m` : `${min}m ${rem}s`
}
