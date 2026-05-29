/**
 * CLI-local agent enum support. The CLI talks to the API over HTTP only and
 * does not depend on @prisma/client, so the enum values + accepted tokens are
 * mirrored here. Keep in sync with prisma `enum TaskArtifactAgent`.
 */

/** enum value → display label (matches lib/i18n en.json taskArtifact.agent.*) */
export const AGENT_LABELS: Record<string, string> = {
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex',
  CURSOR: 'Cursor',
  GEMINI_CLI: 'Gemini CLI',
  GITHUB_COPILOT: 'GitHub Copilot',
  WINDSURF: 'Windsurf',
}

/** accepted CLI token (normalized) → enum value */
const TOKEN_TO_ENUM: Record<string, string> = {
  'claude-code': 'CLAUDE_CODE',
  codex: 'CODEX',
  cursor: 'CURSOR',
  'gemini-cli': 'GEMINI_CLI',
  gemini: 'GEMINI_CLI',
  'github-copilot': 'GITHUB_COPILOT',
  copilot: 'GITHUB_COPILOT',
  windsurf: 'WINDSURF',
}

/** Canonical tokens shown in error/usage hints (aliases omitted). */
export const VALID_AGENT_TOKENS = [
  'claude-code',
  'codex',
  'cursor',
  'gemini-cli',
  'github-copilot',
  'windsurf',
]

/**
 * Normalize a user-supplied agent string to its enum value, or null if
 * unknown. Case-insensitive; spaces and underscores are treated as hyphens.
 */
export function normalizeAgent(input: string): string | null {
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  return TOKEN_TO_ENUM[key] ?? null
}
