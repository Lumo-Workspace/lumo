## Why

Users need a way to create and save Markdown documents within their workspace. Currently, the backend API exists for document creation and management, but there is no user-facing UI to create new documents, edit them with the RichTextEditor, and save changes (both automatically and manually).

## What Changes

- **ADDED**: Document creation UI - Users can create new Markdown documents instantly via a "Create a file" button in the navigation bar (no dialog, uses default title)
- **ADDED**: Document editing integration - RichTextEditor is integrated with document save/load functionality
- **ADDED**: Auto-save functionality - Documents automatically save changes after a period of inactivity
- **ADDED**: Manual save functionality - Users can manually save documents with visual feedback
- **ADDED**: Document list view - Users can see and navigate to their documents in the left sidebar under the "Draft" section
- **ADDED**: Document loading - Existing documents can be loaded into the editor for editing

## Impact

- **Affected specs**: `document-management` (new capability)
- **Affected code**:
  - New components: `components/features/document-management/DocumentCreator.tsx`, `components/features/document-management/DocumentEditor.tsx`, `components/features/document-management/DocumentList.tsx`
  - New hooks: `hooks/use-document-save.ts` (for auto-save and manual save)
  - Modified: `components/core/editor/rich-text/RichTextEditor.tsx` (integration with document API)
  - Modified: `components/workspace/WorkspaceSidebarContent.tsx` (add "Create a file" button in header, integrate document list under Draft section)
  - Modified: `app/workspace/[workspaceUrl]/page.tsx` (add document creation UI)
- **Database**: Uses existing `Document` model (no schema changes)
- **API**: Uses existing `/api/documents` endpoints
