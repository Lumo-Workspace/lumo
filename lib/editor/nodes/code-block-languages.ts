import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/**
 * One display option in the code-block language dropdown.
 * `value` is the highlight.js language id stored in the node's `language`
 * attribute (and emitted as the `language-<value>` class on `<code>`); the
 * empty string means "no language" (plain, un-highlighted). `label` is a
 * proper-noun product name and is intentionally **not** translated.
 */
export interface CodeLanguageOption {
  value: string
  label: string
}

/**
 * Curated set of languages registered for syntax highlighting. Covers the
 * stack this team actually writes (TS/JS/Prisma-SQL/Go/shell/etc.) plus the
 * config formats that show up in specs (JSON/YAML/Markdown). Aliases such as
 * `tsx`/`jsx` reuse the base grammar so pasted code still highlights.
 */
export const CODE_BLOCK_LANGUAGES: CodeLanguageOption[] = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'css', label: 'CSS' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'markdown', label: 'Markdown' },
]

/**
 * Build a lowlight instance with the curated grammar set registered. A fresh
 * instance is created per call so the editor and the read-only viewer don't
 * share mutable highlighter state.
 */
export function createCodeBlockLowlight() {
  const lowlight = createLowlight()
  lowlight.register({
    typescript,
    javascript,
    python,
    go,
    rust,
    java,
    sql,
    bash,
    shell,
    json,
    yaml,
    css,
    xml,
    markdown,
  })
  // Aliases so `language-ts`/`language-tsx`/etc. reuse an existing grammar.
  lowlight.registerAlias({
    typescript: ['ts', 'tsx'],
    javascript: ['js', 'jsx'],
    python: ['py'],
    bash: ['sh', 'zsh'],
    markdown: ['md'],
    xml: ['html'],
  })
  return lowlight
}
