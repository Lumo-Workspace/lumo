// Single source of truth lives in shared/src/markdown-sections.ts (LUM-409) —
// the CLI must slice sections exactly like the server does.
export {
  listSections,
  findSection,
  extractSection,
  replaceSection,
  appendToSection,
  parseSectionQuery,
  type MarkdownSection,
  type SectionMatch,
} from '../../../shared/src/markdown-sections'
