import { EXIT_USAGE } from '../lib/exit-codes'
import { emitJson, withVersion } from '../lib/json-output'
import { fmtCount } from '../lib/format'
import { apiCall, apiContext, type ApiContext } from '../lib/test-case-api'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { loadTemplateFile, type TemplateFileDeps } from '../lib/template-file'
import { successLine } from '../lib/feedback'
import { emitNextSteps, type NextStep } from '../lib/next-steps'

/**
 * LUM-974: `lumo task template show / create / edit / rm`. Task templates are
 * CLI-only (the web UI was removed); the CLI addresses a template by key and
 * resolves it to its id through the list endpoint.
 */

interface TemplateRow {
  id: string | null
  key: string
  name: string
  description: string | null
  isSystem: boolean
  content: string
}

async function listTemplates(
  ctx: ApiContext,
  what: string
): Promise<TemplateRow[] | null> {
  const r = await apiCall<{ templates: TemplateRow[] }>(
    ctx,
    '/api/task-templates',
    {},
    what
  )
  return r.ok && r.data ? r.data.templates : null
}

function unknownKey(key: string): string {
  return `Error: no task template "${sanitizeField(key)}". Run \`lumo task template list\` to see the available keys.`
}

/** Refusal for writes to a built-in key, with the copy-then-create route. */
export function builtInRefusal(key: string, verb: string): string {
  const k = sanitizeField(key)
  return (
    `Error: "${k}" is a built-in template and cannot be ${verb}. ` +
    `To start from it, save a copy and create your own:\n` +
    `  lumo task template show ${k} > ${k}.md\n` +
    `  lumo task template create my-${k} --name "My ${k}" --file ${k}.md`
  )
}

/**
 * Look a template up by key for a write. Prints the error and returns null
 * when the list call fails, the key is unknown, or it is built-in.
 */
async function findWritable(
  ctx: ApiContext,
  key: string,
  verb: string,
  what: string
): Promise<(TemplateRow & { id: string }) | null> {
  const templates = await listTemplates(ctx, what)
  if (!templates) return null
  const found = templates.find(t => t.key === key)
  if (!found) {
    console.error(unknownKey(key))
    return null
  }
  if (found.isSystem || !found.id) {
    console.error(builtInRefusal(key, verb))
    return null
  }
  return found as TemplateRow & { id: string }
}

/** `lumo task template show <key> [--json]` — print the template's Markdown. */
export async function taskTemplateShow(
  key: string,
  opts: { json?: boolean } = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const templates = await listTemplates(ctx, 'task template show')
  if (!templates) return 1
  const t = templates.find(x => x.key === key)
  if (!t) {
    console.error(unknownKey(key))
    return 1
  }
  if (opts.json) {
    const out = {
      key: t.key,
      name: t.name,
      description: t.description,
      isSystem: t.isSystem,
      content: t.content,
    }
    emitJson(withVersion(out))
    return
  }
  // The Markdown body only, so `> file.md` saves the template as-is
  // (terminal control characters stripped, as for every printed field).
  const body = sanitizeField(t.content)
  process.stdout.write(body.endsWith('\n') ? body : `${body}\n`)
}

export interface TemplateCreateOptions {
  name?: string
  file?: string
}

/** `lumo task template create <key> --name <name> --file <path.md>`. */
export async function taskTemplateCreate(
  key: string,
  opts: TemplateCreateOptions,
  deps: Partial<TemplateFileDeps> = {}
): Promise<number | void> {
  if (!opts.name || !opts.file) {
    console.error(
      'Error: --name and --file are required. Usage: lumo task template create <key> --name "<name>" --file <path.md>'
    )
    return EXIT_USAGE
  }
  const loaded = await loadTemplateFile(opts.file, deps)
  if (!loaded.ok) {
    console.error(`Error: ${loaded.message}`)
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1

  const templates = await listTemplates(ctx, 'task template create')
  if (!templates) return 1
  const existing = templates.find(t => t.key === key)
  if (existing?.isSystem) {
    console.error(builtInRefusal(key, 'created'))
    return 1
  }
  if (existing) {
    console.error(
      `Error: task template "${sanitizeField(key)}" already exists. Change it with \`lumo task template edit ${sanitizeField(key)} --file <path.md>\`.`
    )
    return 1
  }

  const r = await apiCall<{ template: TemplateRow }>(
    ctx,
    '/api/task-templates',
    {
      method: 'POST',
      json: { key, name: opts.name, content: loaded.content },
    },
    'task template create'
  )
  if (!r.ok || !r.data) return 1
  const t = r.data.template
  process.stdout.write(formatTemplateCreatedLine(t) + '\n')
  emitNextSteps(templateCreatedNextSteps(t.key))
}

/** LUM-1092: `Created task template <key> "<name>" (<n> chars)`. */
export function formatTemplateCreatedLine(t: {
  key: string
  name: string
  content: string
}): string {
  return successLine({
    verb: 'Created',
    kind: 'task template',
    ref: sanitizeField(t.key),
    title: t.name,
    suffix: `(${fmtCount(t.content.length)} chars)`,
  })
}

/** The usage advice that used to trail the line as `Use it with …`. */
export function templateCreatedNextSteps(key: string): NextStep[] {
  return [
    {
      command: `lumo task create <title> --template ${sanitizeField(key)}`,
      why: 'create a task from this template',
    },
  ]
}

export interface TemplateEditOptions {
  name?: string
  file?: string
  key?: string
}

/** `lumo task template edit <key> [--name] [--file] [--key <new-key>]`. */
export async function taskTemplateEdit(
  key: string,
  opts: TemplateEditOptions,
  deps: Partial<TemplateFileDeps> = {}
): Promise<number | void> {
  if (
    opts.name === undefined &&
    opts.file === undefined &&
    opts.key === undefined
  ) {
    console.error(
      'Error: nothing to change. Pass at least one of --name, --file, --key.'
    )
    return EXIT_USAGE
  }
  const patch: { name?: string; content?: string; key?: string } = {}
  if (opts.file !== undefined) {
    const loaded = await loadTemplateFile(opts.file, deps)
    if (!loaded.ok) {
      console.error(`Error: ${loaded.message}`)
      return 1
    }
    patch.content = loaded.content
  }
  if (opts.name !== undefined) patch.name = opts.name
  if (opts.key !== undefined && opts.key !== key) patch.key = opts.key

  const ctx = apiContext()
  if (!ctx) return 1
  const found = await findWritable(ctx, key, 'edited', 'task template edit')
  if (!found) return 1
  if (Object.keys(patch).length === 0) {
    process.stdout.write(`No change: --key is already ${sanitizeField(key)}.\n`)
    return
  }

  const r = await apiCall<{ template: TemplateRow }>(
    ctx,
    `/api/task-templates/${encodeURIComponent(found.id)}`,
    { method: 'PATCH', json: patch },
    'task template edit'
  )
  if (!r.ok || !r.data) return 1
  const t = r.data.template
  const changed = [
    patch.key !== undefined ? `key → ${sanitizeField(t.key)}` : null,
    patch.name !== undefined ? `name → "${sanitizeField(t.name)}"` : null,
    patch.content !== undefined
      ? `content (${fmtCount(t.content.length)} chars)`
      : null,
  ].filter(Boolean)
  process.stdout.write(
    `Updated task template ${sanitizeField(key)}: ${changed.join(', ')}\n`
  )
}

/** The changes[] block for the rm confirmation envelope. */
export function describeTemplateRm(t: { key: string; name: string }): string[] {
  const name = sanitizeField(t.name).replace(/"/g, '\\"')
  return [
    `Will delete workspace task template ${sanitizeField(t.key)} "${name}"`,
    'Template deletion is irreversible; tasks already created from it keep their description',
  ]
}

/** `lumo task template rm <key> [--confirm]` — exit 4 envelope first. */
export async function taskTemplateRm(
  key: string,
  opts: ConfirmFlags = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const found = await findWritable(ctx, key, 'removed', 'task template rm')
  if (!found) return 1

  if (!isConfirmed(opts)) {
    return emitConfirmation({
      command: 'task template rm',
      changes: describeTemplateRm(found),
    })
  }

  const r = await apiCall<{ success: boolean }>(
    ctx,
    `/api/task-templates/${encodeURIComponent(found.id)}`,
    { method: 'DELETE' },
    'task template rm'
  )
  if (!r.ok) return 1
  process.stdout.write(`Removed task template ${sanitizeField(key)}\n`)
}
