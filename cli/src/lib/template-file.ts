import * as fs from 'fs'
import { checkArtifactFilePath, type PathGuardResult } from './path-guard'
import { unreadableFileMessage } from './doc-input'

/** Mirrors the content cap in `lib/validation/task-template.ts` (LUM-970). */
export const TEMPLATE_CONTENT_MAX = 20_000

export interface TemplateFileDeps {
  checkFilePath: (p: string) => PathGuardResult
  readFile: (p: string) => Promise<Buffer>
  readStdin: () => Promise<Buffer>
}

export type TemplateFileResult =
  | { ok: true; content: string }
  | { ok: false; message: string }

function readStdinBytes(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', chunk =>
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    )
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
    process.stdin.on('error', reject)
  })
}

const defaultDeps: TemplateFileDeps = {
  checkFilePath: p => checkArtifactFilePath(p),
  readFile: p => fs.promises.readFile(p),
  readStdin: readStdinBytes,
}

/** Strict UTF-8 decode (no U+FFFD substitution); drops a leading BOM. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.startsWith('﻿') ? text.slice(1) : text
  } catch {
    return null
  }
}

/**
 * LUM-974: read a task template's Markdown from `--file <path>` (`-` = stdin)
 * and check it locally — present, UTF-8, non-empty, within the 20,000-char
 * cap — so a bad file fails here with a clear message instead of being
 * truncated or rejected by the server. Nothing is uploaded on failure.
 */
export async function loadTemplateFile(
  file: string,
  deps: Partial<TemplateFileDeps> = {}
): Promise<TemplateFileResult> {
  const d = { ...defaultDeps, ...deps }
  const label = file === '-' ? 'stdin' : `file ${file}`

  let bytes: Buffer
  if (file === '-') {
    bytes = await d.readStdin()
  } else {
    const verdict = d.checkFilePath(file)
    if (!verdict.ok) {
      return {
        ok: false,
        message:
          verdict.reason === 'unreadable'
            ? unreadableFileMessage(file)
            : `refusing to read ${file} — ${verdict.detail}. ` +
              '--file must be a non-sensitive path inside the project directory ' +
              '(or pipe it in with `--file - < path`).',
      }
    }
    try {
      bytes = await d.readFile(verdict.resolved)
    } catch {
      return { ok: false, message: unreadableFileMessage(file) }
    }
  }

  const content = decodeUtf8Strict(bytes)
  if (content === null) {
    return {
      ok: false,
      message: `${label} is not valid UTF-8 text — save it as UTF-8 and retry.`,
    }
  }
  if (content.trim().length === 0) {
    return { ok: false, message: `${label} is empty.` }
  }
  if (content.length > TEMPLATE_CONTENT_MAX) {
    return {
      ok: false,
      message:
        `${label} is ${content.length.toLocaleString('en-US')} characters; ` +
        `a task template is capped at ${TEMPLATE_CONTENT_MAX.toLocaleString('en-US')}. ` +
        'Shorten it and retry (nothing was uploaded).',
    }
  }
  return { ok: true, content }
}
