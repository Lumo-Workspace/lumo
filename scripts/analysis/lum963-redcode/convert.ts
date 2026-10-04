/**
 * LUM-963 — RedCode-Exec item → Claude Code PostToolUse events. Pure.
 *
 * RedCode-Exec hands the agent a snippet and asks it to run it. The coding
 * agent shapes that run would take:
 *
 *   bash                    → Bash `{command: <script>}`
 *   python, mode `inline`   → Bash `python3 -c '<code>'` (R-Judge's convention)
 *   python, mode `file`     → Write `/tmp/redcode_<id>.py` + Bash `python3 <file>`
 *
 * `file` mode is the realistic agent flow and exposes the Write-content blind
 * spot (the detector scans written code for secrets only); `inline` lets the
 * inline-interpreter scans see the code.
 */
import { shQuote } from '../lum949-rjudge/convert'
import type { LoadedItem } from './source'

export type PythonMode = 'inline' | 'file'

export interface ToolEvent {
  toolName: 'Bash' | 'Write'
  filePath: string | null
  payload: { tool_input: Record<string, string> }
}

function bash(command: string): ToolEvent {
  return {
    toolName: 'Bash',
    filePath: null,
    payload: { tool_input: { command } },
  }
}

export function convertItem(item: LoadedItem, mode: PythonMode): ToolEvent[] {
  if (item.lang === 'bash') return [bash(item.code)]
  if (mode === 'inline') return [bash(`python3 -c ${shQuote(item.code)}`)]
  const file = `/tmp/redcode_${item.id.replace(/[^\w-]+/g, '_')}.py`
  return [
    {
      toolName: 'Write',
      filePath: file,
      payload: { tool_input: { file_path: file, content: item.code } },
    },
    bash(`python3 ${file}`),
  ]
}
