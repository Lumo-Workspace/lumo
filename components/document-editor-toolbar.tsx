"use client"

import { Button } from "@/components/ui/button"
import { PanelRight, PanelRightClose } from "lucide-react"

interface DocumentEditorToolbarProps {
  onFormat: (command: string, value?: string) => void
  onAddTask: () => void
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  isAutoSaving: boolean
  lastSaved: Date | null
}

export function DocumentEditorToolbar({
  onFormat,
  onAddTask,
  isSidebarOpen,
  onToggleSidebar,
  isAutoSaving,
  lastSaved,
}: DocumentEditorToolbarProps) {
  return (
    <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Document Editor</h1>

        {/* Save Status */}
        <div className="flex items-center gap-2 text-sm">
          {isAutoSaving ? (
            <div className="flex items-center gap-2 text-blue-600">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span>Saving...</span>
            </div>
          ) : lastSaved ? (
            <span className="text-green-600">Saved {lastSaved.toLocaleTimeString()}</span>
          ) : (
            <span className="text-gray-500">Not saved</span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onFormat("bold")} className="min-w-[44px]">
          <strong>B</strong>
        </Button>
        <Button variant="outline" size="sm" onClick={() => onFormat("italic")} className="min-w-[44px]">
          <em>I</em>
        </Button>
        <Button variant="outline" size="sm" onClick={() => onFormat("insertUnorderedList")} className="min-w-[44px]">
          •
        </Button>
        <Button variant="outline" size="sm" onClick={onAddTask} className="ml-2 bg-transparent">
          + Task
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onToggleSidebar}
          className="ml-2 bg-transparent"
          title={isSidebarOpen ? "Hide task panel" : "Show task panel"}
        >
          {isSidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
