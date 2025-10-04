"use client"

import type React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import TaskWidgetComponent from "@/components/task-widget"
import type { DocumentBlock, TaskWidget } from "@/hooks/use-document-blocks"

interface DocumentBlockProps {
  block: DocumentBlock
  index: number
  isActive: boolean
  onContentChange: (blockId: string, content: string) => void
  onFocus: (blockId: string) => void
  onKeyDown: (e: React.KeyboardEvent, blockId: string) => void
  onAddTask: (afterBlockId: string) => void
  onTaskStatusChange: (taskId: string, newStatus: TaskWidget["status"]) => void
  onTaskEdit: (taskId: string) => void
  onTaskDelete: (taskId: string) => void
}

export function DocumentBlock({
  block,
  index,
  isActive,
  onContentChange,
  onFocus,
  onKeyDown,
  onAddTask,
  onTaskStatusChange,
  onTaskEdit,
  onTaskDelete,
}: DocumentBlockProps) {
  if (block.type === "text") {
    return (
      <div className="mb-4 group">
        <div className="relative">
          <div
            contentEditable
            suppressContentEditableWarning
            className={cn(
              "min-h-[1.5rem] outline-none focus:bg-blue-50/30 rounded px-2 py-1 transition-colors",
              "prose prose-sm max-w-none",
              "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4",
              "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3",
              "[&_h3]:text-lg [&_h3]:font-medium [&_h3]:mb-2",
              "[&_ul]:list-disc [&_ul]:ml-6 [&_ul]:mb-4",
              "[&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:mb-4",
              "[&_li]:mb-1",
              "[&_strong]:font-semibold",
              "[&_em]:italic",
            )}
            onInput={(e) => onContentChange(block.id, e.currentTarget.innerHTML)}
            onFocus={() => onFocus(block.id)}
            onKeyDown={(e) => onKeyDown(e, block.id)}
            dangerouslySetInnerHTML={{ __html: block.content }}
            data-placeholder={index === 0 ? "Start writing your document..." : "Continue writing..."}
          />

          {/* Block Actions */}
          <div className="absolute -left-12 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAddTask(block.id)}
              className="w-8 h-8 p-0 text-gray-400 hover:text-gray-600"
              title="Insert task"
            >
              +
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="my-6">
      <TaskWidgetComponent
        task={block.task!}
        context={{
          isEmbedded: true,
          canEdit: true,
          showFullDetails: false,
        }}
        onStatusChange={onTaskStatusChange}
        onEdit={onTaskEdit}
        onDelete={onTaskDelete}
      />
    </div>
  )
}
