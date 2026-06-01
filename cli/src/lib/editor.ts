import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Open `initial` in the user's $EDITOR (fallback vi → nano), return the edited
 * text. Degrades gracefully: when stdin is not a TTY (piped / agent) or the
 * editor exits non-zero, the original text is returned unchanged so the caller
 * can proceed without an interactive editor.
 */
export async function editInEditor(initial: string): Promise<string> {
  if (!process.stdin.isTTY) return initial

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-wrap-'))
  const file = path.join(dir, 'progress.md')
  try {
    fs.writeFileSync(file, initial, 'utf8')
    const result = spawnSync(editor, [file], { stdio: 'inherit' })
    if (result.status !== 0) return initial
    return fs.readFileSync(file, 'utf8')
  } catch {
    return initial
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
