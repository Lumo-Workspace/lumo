import { isSystemTemplateKey } from '@/lib/task-templates/system'

/** Mirrors the key / name caps in `lib/validation/task-template.ts`. */
const KEY_MAX = 40
const NAME_MAX = 80

/** Cut `stem` so `${stem}${suffix}` fits the key cap, without a dangling hyphen. */
function fitKey(stem: string, suffix: string): string {
  const room = KEY_MAX - suffix.length
  return `${stem.slice(0, room).replace(/-+$/, '')}${suffix}`
}

/**
 * LUM-972: the key for a workspace copy of template `sourceKey` —
 * `<key>-copy`, then `<key>-copy-2`, `-3`, … — skipping built-in keys and
 * every key in `takenKeys` (the workspace's existing templates).
 */
export function copyTemplateKey(
  sourceKey: string,
  takenKeys: Iterable<string>
): string {
  const taken = new Set(takenKeys)
  const isFree = (key: string) => !taken.has(key) && !isSystemTemplateKey(key)
  for (let n = 1; ; n++) {
    const key = fitKey(sourceKey, n === 1 ? '-copy' : `-copy-${n}`)
    if (isFree(key)) return key
  }
}

/** Clamp a localized copy name (e.g. “Agent brief (copy)”) to the name cap. */
export function clampTemplateName(name: string): string {
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX).trimEnd() : name
}
