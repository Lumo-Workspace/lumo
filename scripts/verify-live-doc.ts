/**
 * Verify a live Lumo document against its authoritative markdown source.
 *
 * Renders the source with the same `markdownToHtml` the documents API uses
 * for `contentMarkdown` uploads, fetches the stored HTML via
 * `GET /api/documents/<docId>`, and compares structural tag counts.
 * `<table>` / `<tr>` mismatches are hard failures (exit 1) — they mean the
 * stored doc lost (or gained) table structure relative to the source, the
 * exact regression this guards against (LUM-349: doc-show round-trips
 * flatten tables). Other tag drift is reported as a warning only, since a
 * Web-UI edit after the last upload can legitimately change prose.
 *
 * Usage:
 *   npx tsx scripts/verify-live-doc.ts <docId> <source.md>
 *
 * Auth: reads ~/.lumo/credentials.json (or $LUMO_CONFIG_DIR), same as the
 * lumo CLI. LUMO_TOKEN / LUMO_API_URL env vars override.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { markdownToHtml } from '../shared/src/markdown-tiptap'

export interface StructureCheck {
  tag: string
  rendered: number
  stored: number
  /** Hard checks fail the run; soft checks only warn. */
  hard: boolean
}

const TAG_PATTERNS: Array<{ tag: string; pattern: RegExp; hard: boolean }> = [
  { tag: 'table', pattern: /<table/g, hard: true },
  { tag: 'tr', pattern: /<tr/g, hard: true },
  { tag: 'h1', pattern: /<h1/g, hard: false },
  { tag: 'h2', pattern: /<h2/g, hard: false },
  { tag: 'h3', pattern: /<h3/g, hard: false },
  { tag: 'li', pattern: /<li/g, hard: false },
  { tag: 'a', pattern: /<a[\s>]/g, hard: false },
  { tag: 'strong', pattern: /<strong/g, hard: false },
  { tag: 'code', pattern: /<code/g, hard: false },
  { tag: 'blockquote', pattern: /<blockquote/g, hard: false },
]

export function countPattern(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

export function compareStructure(
  renderedHtml: string,
  storedHtml: string
): StructureCheck[] {
  return TAG_PATTERNS.map(({ tag, pattern, hard }) => ({
    tag,
    rendered: countPattern(renderedHtml, pattern),
    stored: countPattern(storedHtml, pattern),
    hard,
  }))
}

export function hardMismatches(checks: StructureCheck[]): StructureCheck[] {
  return checks.filter(c => c.hard && c.rendered !== c.stored)
}

export function softMismatches(checks: StructureCheck[]): StructureCheck[] {
  return checks.filter(c => !c.hard && c.rendered !== c.stored)
}

interface Credentials {
  token: string
  apiUrl: string
}

function readCredentials(): Credentials {
  const envToken = process.env.LUMO_TOKEN
  const envUrl = process.env.LUMO_API_URL
  if (envToken && envUrl) return { token: envToken, apiUrl: envUrl }

  const dir = process.env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
  const p = path.join(dir, 'credentials.json')
  if (!fs.existsSync(p)) {
    throw new Error(
      `No credentials: ${p} not found and LUMO_TOKEN/LUMO_API_URL not set. ` +
        `Run \`lumo auth login\` first.`
    )
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<Credentials>
  if (typeof data.token !== 'string' || typeof data.apiUrl !== 'string') {
    throw new Error(`Malformed credentials file at ${p}`)
  }
  return {
    token: envToken ?? data.token,
    apiUrl: envUrl ?? data.apiUrl,
  }
}

async function fetchStoredHtml(docId: string): Promise<string> {
  const { token, apiUrl } = readCredentials()
  const res = await fetch(`${apiUrl}/api/documents/${docId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`GET /api/documents/${docId} failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as {
    content?: string
    document?: { content?: string }
  }
  const content = body.document?.content ?? body.content
  if (typeof content !== 'string') {
    throw new Error(`Document ${docId} response has no string \`content\``)
  }
  return content
}

async function main(): Promise<void> {
  const [docId, sourcePath] = process.argv.slice(2)
  if (!docId || !sourcePath) {
    console.error(
      'Usage: npx tsx scripts/verify-live-doc.ts <docId> <source.md>'
    )
    process.exit(2)
  }

  const source = fs.readFileSync(sourcePath, 'utf8')
  const rendered = markdownToHtml(source)
  const stored = await fetchStoredHtml(docId)
  const checks = compareStructure(rendered, stored)

  for (const c of checks) {
    const status = c.rendered === c.stored ? 'OK' : c.hard ? 'FAIL' : 'WARN'
    console.log(
      `${c.tag.padEnd(10)} source=${String(c.rendered).padEnd(4)} stored=${String(c.stored).padEnd(4)} ${status}`
    )
  }

  const hard = hardMismatches(checks)
  const soft = softMismatches(checks)
  if (soft.length > 0) {
    console.warn(
      `\nWarning: prose structure drift (${soft.map(c => c.tag).join(', ')}). ` +
        `If the doc was edited in the Web UI since the last upload, sync the ` +
        `source file before the next \`lumo doc update\`.`
    )
  }
  if (hard.length > 0) {
    console.error(
      `\nFAIL: table structure mismatch (${hard
        .map(c => `${c.tag}: source=${c.rendered} stored=${c.stored}`)
        .join('; ')}). The stored document lost or gained table structure ` +
        `relative to ${sourcePath}.`
    )
    process.exit(1)
  }
  console.log(`\nOK: ${docId} table structure matches ${sourcePath}`)
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
