## ADDED Requirements

### Requirement: Document Creation

Users SHALL be able to create new Markdown documents within their workspace.

#### Scenario: Create new document from navigation bar

- **WHEN** a user clicks the "Create a file" button in the navigation bar header
- **THEN** a new document is immediately created via POST `/api/documents` with a default title (e.g., "Untitled" or timestamp-based)
- **AND** the document is opened in the RichTextEditor for editing
- **AND** the document status is set to "draft"
- **AND** the new document appears in the document list under the Draft section in the sidebar
- **AND** the user can edit the document title later if needed

#### Scenario: Create new document from sidebar

- **WHEN** a user clicks a "New Document" button in the Draft section of the sidebar
- **THEN** a new document is immediately created via POST `/api/documents` with a default title (e.g., "Untitled" or timestamp-based)
- **AND** the document is opened in the RichTextEditor for editing
- **AND** the document status is set to "draft"
- **AND** the new document appears in the document list in the sidebar
- **AND** the user can edit the document title later if needed

#### Scenario: Edit document title after creation

- **WHEN** a user creates a new document (via "Create a file" button or "New Document" button)
- **AND** the document is opened in the editor
- **THEN** the user can edit the document title (e.g., by clicking on the title in the editor or sidebar)
- **AND** title changes are saved automatically or via manual save

### Requirement: Document Editing

Users SHALL be able to edit document content and title using the RichTextEditor.

#### Scenario: Load existing document

- **WHEN** a user selects an existing document from the document list
- **THEN** the document content is fetched via GET `/api/documents/[id]`
- **AND** the content is loaded into the RichTextEditor
- **AND** the document title is displayed

#### Scenario: Edit document content

- **WHEN** a user makes changes to document content in the RichTextEditor
- **THEN** changes are tracked for auto-save
- **AND** the editor displays the updated content in real-time

#### Scenario: Edit document title

- **WHEN** a user wants to change a document title
- **THEN** the user can edit the title (e.g., by clicking on the title in the editor header or sidebar)
- **AND** title changes are saved via PATCH `/api/documents/[id]`
- **AND** the updated title is reflected in the document list

### Requirement: Auto-Save

Documents SHALL automatically save changes after a period of user inactivity.

#### Scenario: Auto-save after inactivity

- **WHEN** a user makes changes to document content
- **AND** no further changes are made for 2 seconds
- **THEN** the document is automatically saved via PATCH `/api/documents/[id]`
- **AND** a visual indicator shows "Saving..." during the save operation
- **AND** after successful save, the indicator shows "Saved" or disappears

#### Scenario: Auto-save with network error

- **WHEN** auto-save is triggered
- **AND** the save request fails (network error, validation error)
- **THEN** the save state indicator shows an error state (e.g., error icon or "Failed to save" text) in a non-disruptive way
- **AND** the document remains in an "unsaved" state
- **AND** auto-save retries after the next inactivity period
- **AND** the error indicator does not block the user from continuing to edit
- **AND** the user can manually retry save by clicking the save button or waiting for auto-retry

### Requirement: Manual Save

Users SHALL be able to manually save documents with explicit user action.

#### Scenario: Manual save

- **WHEN** a user clicks the "Save" button
- **THEN** the document is immediately saved via PATCH `/api/documents/[id]`
- **AND** a success message or visual feedback confirms the save
- **AND** the save timestamp is updated

#### Scenario: Manual save with unsaved changes

- **WHEN** a user clicks "Save" with unsaved changes
- **THEN** all pending changes are saved
- **AND** the save indicator confirms successful save

### Requirement: Document List

Users SHALL be able to view a list of their documents and navigate to them from the left sidebar.

#### Scenario: View document list in sidebar

- **WHEN** a user is in the workspace
- **THEN** a document list is displayed in the left sidebar under the "Draft" section
- **AND** the list shows:
  - Document title
  - Last updated timestamp (relative time, e.g., "2 hours ago")
  - Document status indicator (draft/published/archived)
- **AND** documents are ordered by most recently updated first
- **AND** the list is scrollable if there are many documents

#### Scenario: Navigate to document from sidebar

- **WHEN** a user clicks on a document in the sidebar list
- **THEN** the document is loaded into the editor
- **AND** the document title is displayed
- **AND** the document content is editable
- **AND** the clicked document is highlighted in the sidebar list

### Requirement: Navigation Bar Create Button

The navigation bar SHALL provide a "Create a file" button for quick document creation.

#### Scenario: Create button visibility

- **WHEN** a user is in the workspace
- **THEN** a "Create a file" button is visible in the navigation bar header
- **AND** the button is clearly labeled and accessible

#### Scenario: Create button interaction

- **WHEN** a user clicks the "Create a file" button in the navigation bar
- **THEN** a new document is immediately created without showing any dialog
- **AND** the document is created with a default title (e.g., "Untitled" or timestamp-based)
- **AND** the document appears in the Draft section list
- **AND** the document is opened in the editor for editing

### Requirement: Save State Indication

The UI SHALL clearly indicate the save state of the current document.

#### Scenario: Unsaved changes indicator

- **WHEN** a user makes changes to a document
- **AND** changes have not been saved yet
- **THEN** a visual indicator (e.g., "Unsaved changes" or asterisk) is displayed
- **AND** the indicator disappears after successful save

#### Scenario: Saving indicator

- **WHEN** a save operation is in progress (auto-save or manual save)
- **THEN** a "Saving..." indicator is displayed in a non-disruptive location (e.g., status bar, save button area)
- **AND** the indicator does not block or interrupt the user's editing workflow
- **AND** the indicator is removed after the save completes (success or failure)

#### Scenario: Save error indicator

- **WHEN** a save operation fails (auto-save or manual save)
- **THEN** the save state indicator shows an error state (e.g., error icon, warning color, or "Failed to save" text) in a non-disruptive location (e.g., status bar, save button area)
- **AND** the error indicator does not block or interrupt the user's editing workflow
- **AND** the document remains in an "unsaved" state
- **AND** the user can retry the save manually or wait for auto-retry
- **AND** the error indicator persists until the next successful save or manual retry
