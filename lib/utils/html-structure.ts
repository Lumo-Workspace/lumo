// Single source of truth lives in shared/src/html-structure.ts (LUM-410) —
// the documents service guard and scripts/verify-live-doc.ts must agree on
// what counts as document structure.
export {
  TAG_PATTERNS,
  countPattern,
  compareStructure,
  hardMismatches,
  softMismatches,
  structureShrinks,
  formatStructureShrinks,
  type StructureCheck,
  type StructureShrink,
} from '../../shared/src/html-structure'
