/**
 * Human-readable display names for the `TaskArtifactAgent` enum, shared by
 * anything that surfaces "which coding agent did this" to a human (artifact
 * cards, the parallel-edit collision warning, …). Keep this the single source
 * of truth so labels don't drift between features.
 */
const AGENT_LABELS: Record<string, string> = {
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex',
  CURSOR: 'Cursor',
  GEMINI_CLI: 'Gemini CLI',
  GITHUB_COPILOT: 'GitHub Copilot',
  WINDSURF: 'Windsurf',
}

/**
 * Map an agent enum value to its display label, falling back to the raw value
 * for unknown/future agents (and to a generic label for null/empty).
 */
export function agentLabel(agent: string | null | undefined): string {
  if (!agent) return 'an agent'
  return AGENT_LABELS[agent] ?? agent
}
