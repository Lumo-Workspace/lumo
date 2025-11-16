## MODIFIED Requirements: Document Management — Sidebar interactions

#### Scenario: Show delete in context menu on document item

- GIVEN the user is on the Workspace page with the sidebar visible
- AND the Draft group lists one or more documents
- WHEN the user right‑clicks on a document row
- THEN a context menu appears with a “Delete” option

#### Scenario: Confirm deletion before proceeding

- GIVEN the context menu is open for a document
- WHEN the user selects “Delete”
- THEN a confirmation dialog appears with “Delete” and “Cancel”
- AND choosing “Delete” proceeds to delete the document
- AND choosing “Cancel” closes the dialog without changes

#### Scenario: Soft delete document

- GIVEN the user confirmed deletion
- WHEN the app calls DELETE /api/documents/[id]
- THEN the document is soft‑deleted by setting `deletedAt` to the current timestamp
- AND the document no longer appears in GET /api/documents results (which already filter `deletedAt: null`)

#### Scenario: Update sidebar instantly

- GIVEN a document was deleted
- WHEN the deletion succeeds
- THEN the deleted document is removed from the sidebar list immediately (no page reload)

#### Scenario: Editor reacts to deletion of the currently open document

- GIVEN a document is currently open in the editor
- WHEN that document is deleted via the sidebar
- THEN the editor returns to the empty state view (“Select a document to start editing”)

#### Scenario: Error handling is non‑disruptive

- GIVEN a network or server error occurs during deletion
- WHEN the user attempts deletion
- THEN the UI shows a non‑disruptive toast error message
- AND any optimistic removal is reverted so the document remains visible
