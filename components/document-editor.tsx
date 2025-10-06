"use client"

import type React from "react"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import TaskModal from "@/components/task-modal"
import TaskSidebar from "@/components/task-sidebar"
import { DocumentEditorToolbar } from "@/components/document-editor-toolbar"
import { DocumentBlock } from "@/components/document-block"
import { FloatingMenu } from "@/components/floating-menu"
import {
  useDocumentBlocks,
  type DocumentBlock as DocumentBlockType,
  type TaskWidget,
} from "@/hooks/use-document-blocks"
import { useAutoSave } from "@/hooks/use-auto-save"
import { useTaskManagement } from "@/hooks/use-task-management"
import { useTextSelection } from "@/hooks/use-text-selection"

interface DocumentEditorProps {
  initialContent?: DocumentBlockType[]
  onSave?: (content: DocumentBlockType[]) => void
  className?: string
}

const DocumentEditor: React.FC<DocumentEditorProps> = ({ initialContent = [], onSave, className }) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  const {
    blocks,
    activeBlockId,
    setActiveBlockId,
    updateBlockContent,
    addTextBlock,
    addTaskBlock,
    updateTaskBlock,
  } = useDocumentBlocks(initialContent)

  const { isAutoSaving, lastSaved } = useAutoSave(blocks, onSave)

  const { isTaskModalOpen, editingTask, modalMode, openCreateTaskModal, openEditTaskModal, closeTaskModal } =
    useTaskManagement()

  const { selection, hideMenu } = useTextSelection()

  // Handle text formatting
  const formatText = (command: string, value?: string) => {
    document.execCommand(command, false, value)
  }

  // Handle keyboard shortcuts
  const handleKeyboardShortcuts = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault()
          formatText('bold')
          break
        case 'i':
          e.preventDefault()
          formatText('italic')
          break
        case 'u':
          e.preventDefault()
          formatText('underline')
          break
        case 'k':
          e.preventDefault()
          const url = prompt("Enter URL:")
          if (url) formatText('createLink', url)
          break
        default:
          break
      }
    }
  }

  // Handle task operations
  const handleTaskStatusChange = (taskId: string, newStatus: TaskWidget["status"]) => {
    updateTaskBlock({ ...blocks.find((b) => b.task?.id === taskId)?.task!, status: newStatus })
  }

  const handleTaskEdit = (taskId: string) => {
    const block = blocks.find((b) => b.task?.id === taskId)
    if (block?.task) {
      openEditTaskModal(block.task)
    }
  }

  const handleTaskDelete = (taskId: string) => {
    // Remove the block containing this task
    const blockToDelete = blocks.find((b) => b.task?.id === taskId)
    if (blockToDelete) {
      // This would need to be implemented in the useDocumentBlocks hook
      // TODO: Implement task block deletion
    }
  }

  const handleTaskSave = (taskData: TaskWidget) => {
    if (modalMode === "create") {
      addTaskBlock(taskData)
    } else {
      updateTaskBlock(taskData)
    }
    closeTaskModal()
  }

  // Get all tasks from blocks
  const allTasks = blocks.filter((block) => block.type === "task" && block.task).map((block) => block.task!)

  return (
    <div className={cn("flex", className)}>
      {/* Main Editor */}
      <div className="flex-1 max-w-4xl mx-auto">
        <DocumentEditorToolbar
          onFormat={formatText}
          onAddTask={openCreateTaskModal}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isAutoSaving={isAutoSaving}
          lastSaved={lastSaved}
        />

        {/* Document Content */}
        <div
          ref={editorRef}
          className="min-h-[500px] bg-white rounded-lg border border-gray-200 p-6 focus-within:border-blue-500 transition-colors"
          onKeyDown={handleKeyboardShortcuts}
          tabIndex={0}
        >
          {blocks.map((block, index) => (
            <DocumentBlock
              key={block.id}
              block={block}
              index={index}
              isActive={activeBlockId === block.id}
              onContentChange={updateBlockContent}
              onFocus={setActiveBlockId}
              onKeyDown={handleKeyboardShortcuts}
              onAddTask={() => openCreateTaskModal()}
              onTaskStatusChange={handleTaskStatusChange}
              onTaskEdit={handleTaskEdit}
              onTaskDelete={handleTaskDelete}
            />
          ))}

          {/* Add Block Button */}
          <div className="flex items-center gap-2 mt-8 pt-4 border-t border-gray-100">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => addTextBlock()}
              className="text-gray-500 hover:text-gray-700"
            >
              + Add text
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={openCreateTaskModal}
              className="text-gray-500 hover:text-gray-700"
            >
              + Add task
            </Button>
          </div>
        </div>

        {/* Task Modal */}
        <TaskModal
          isOpen={isTaskModalOpen}
          onClose={closeTaskModal}
          onSave={handleTaskSave}
          task={editingTask}
          mode={modalMode}
        />
      </div>

      {isSidebarOpen && (
        <TaskSidebar
          tasks={allTasks}
          onTaskStatusChange={handleTaskStatusChange}
          onTaskEdit={handleTaskEdit}
          onTaskDelete={handleTaskDelete}
        />
      )}

      {/* Floating Menu */}
      {selection.isVisible && (
        <FloatingMenu
          position={selection.position}
          onFormat={formatText}
          onClose={hideMenu}
        />
      )}
    </div>
  )
}

export default DocumentEditor
