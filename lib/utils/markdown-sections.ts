// Single source of truth lives in shared/src/markdown-sections.ts (LUM-409) —
// the documents service and the CLI must agree byte-for-byte on section
// boundaries.
export {
  listSections,
  findSection,
  extractSection,
  replaceSection,
  appendToSection,
  parseSectionQuery,
  type MarkdownSection,
  type SectionMatch,
} from '../../shared/src/markdown-sections'
