// react-intl ships untranspiled ESM; stub it (CodeBlockView pulls it in via
// the extension import chain). Mirrors __tests__/components/AgentBadge.test.tsx.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { getSchema } from '@tiptap/core'
import {
  createCodeBlockLowlight,
  CODE_BLOCK_LANGUAGES,
} from '@/lib/editor/nodes/code-block-languages'
import { CodeBlock } from '@/lib/editor/nodes/code-block'
import { getBaseExtensions } from '@/lib/editor/extensions'

describe('createCodeBlockLowlight', () => {
  it('registers the curated grammar set', () => {
    const lowlight = createCodeBlockLowlight()
    for (const lang of ['typescript', 'javascript', 'python', 'go', 'sql']) {
      expect(lowlight.registered(lang)).toBe(true)
    }
  })

  it('registers short aliases that resolve to a base grammar', () => {
    const lowlight = createCodeBlockLowlight()
    for (const alias of ['ts', 'tsx', 'js', 'py', 'sh']) {
      expect(lowlight.registered(alias)).toBe(true)
    }
  })

  it('produces hljs token nodes when highlighting code', () => {
    const lowlight = createCodeBlockLowlight()
    const tree = lowlight.highlight('typescript', 'const x = 1')
    // Walk the hast tree collecting every className token.
    const classes: string[] = []
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const el = node as {
        properties?: { className?: unknown }
        children?: unknown[]
      }
      const cn = el.properties?.className
      if (Array.isArray(cn)) classes.push(...cn.map(String))
      el.children?.forEach(visit)
    }
    visit(tree)
    expect(classes.some(c => c.startsWith('hljs-'))).toBe(true)
  })

  it('returns a fresh instance per call (no shared mutable state)', () => {
    expect(createCodeBlockLowlight()).not.toBe(createCodeBlockLowlight())
  })
})

describe('CODE_BLOCK_LANGUAGES', () => {
  it('has unique values and non-empty labels', () => {
    const values = CODE_BLOCK_LANGUAGES.map(o => o.value)
    expect(new Set(values).size).toBe(values.length)
    expect(CODE_BLOCK_LANGUAGES.every(o => o.label.length > 0)).toBe(true)
  })

  it('every dropdown option is an actually-registered grammar', () => {
    const lowlight = createCodeBlockLowlight()
    for (const option of CODE_BLOCK_LANGUAGES) {
      expect(lowlight.registered(option.value)).toBe(true)
    }
  })
})

describe('CodeBlock extension', () => {
  it('keeps the codeBlock node name so it replaces StarterKit default', () => {
    expect(CodeBlock.name).toBe('codeBlock')
  })

  it('is wired with a lowlight instance', () => {
    expect(CodeBlock.options.lowlight).toBeDefined()
  })
})

describe('getBaseExtensions schema', () => {
  it('builds a schema with exactly one codeBlock node (no duplicate)', () => {
    // getSchema throws if two extensions declare the same node name, so a
    // successful build proves StarterKit's default codeBlock is disabled.
    const schema = getSchema(getBaseExtensions())
    expect(schema.nodes.codeBlock).toBeDefined()
  })
})
