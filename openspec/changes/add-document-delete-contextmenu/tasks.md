## 1. Implementation

- [x] Add shadcn/ui context menu primitives under `components/ui/context-menu.tsx`
- [x] Integrate context menu on document rows in `components/features/document-management/PageTree.tsx`
- [x] Use `ContextMenuItem` with `variant="destructive"` for Delete
- [x] Wire rename/delete handlers through `components/layouts/EditorSidebar.tsx`
- [x] Remove legacy custom overlay menu usage in `components/core/editor/demo-workspace/DemoWorkspaceContainer.tsx`

## 2. Verification

- [x] Right-click on a document row shows a menu with Rename and Delete
- [x] Delete shows destructive styling
- [x] Delete flows to confirmation dialog and deletes after confirm
