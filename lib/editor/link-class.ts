/**
 * The class the editor's Link extension stamps on every link. Lives on its
 * own so the rich-text sanitizer allowlist (lib/html/rich-html-policy.ts)
 * can accept exactly these classes without importing tiptap.
 */
export const EDITOR_LINK_CLASS = 'text-blue-500 underline cursor-pointer'
