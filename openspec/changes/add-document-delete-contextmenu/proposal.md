# Proposal: Add Delete action via right‑click context menu in sidebar document list

## Summary

Add a minimal, consistent way to delete documents from the left sidebar. When the user right‑clicks a document item under the Draft section, a context menu appears with a Delete option. Deletion is soft (sets `deletedAt`), updates the UI list immediately, and does not navigate away if the deleted document was not currently open. If the deleted document is open in the editor, the editor returns to the empty state (“Select a document to start editing”).

## Goals

- Provide a straightforward Delete action on document items via context menu.
- Ensure deletion is soft (recoverable later if needed; follow existing schema patterns).
- Keep the UI responsive: optimistic removal with graceful error handling.
- Maintain consistency with shadcn/ui and current Workspace sidebar structure.

## Non‑Goals (for this change)

- Implement bulk deletion or multi‑select.
- Implement a trash/recovery UI (can be a follow‑up change).
- Cross‑workspace operations.

## Open Questions

1. Should we add a secondary confirmation step (Confirm dialog) before deletion? Default proposal: Yes, a simple confirm dialog to prevent accidental deletion.
2. Should we show a transient toast on success/failure? Default proposal: Yes, non‑disruptive toast on both success and error.
3. Permission model: assume the current user has permission to delete documents in the active workspace (auth already in place).

## Acceptance Criteria

- Right‑clicking a document list item shows a context menu with a Delete option.
- Clicking Delete shows a confirmation (if accepted, proceed).
- The document is soft‑deleted (`deletedAt` set), and disappears from the Draft list without refresh.
- If the deleted item was currently open, the editor returns to the empty state.
- Errors are surfaced non‑disruptively (toast) and the list reverts if the optimistic change fails.
