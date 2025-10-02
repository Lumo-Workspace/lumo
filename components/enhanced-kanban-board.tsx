"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import AIEpicStoryGenerator from "./ai-epic-story-generator"
import AIProgressSummary from "./kanban/ai-progress-summary"
import KanbanCard from "./kanban/kanban-card"
import {
  type EnhancedKanbanItem,
  statusColumns,
  getItemsByStatus,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragStart,
} from "@/utils/kanban-utils"

interface EnhancedKanbanBoardProps {
  items: EnhancedKanbanItem[]
  onStatusChange: (itemId: string, newStatus: string) => void
  type: "project" | "prd" | "epic" | "story"
  context: string
}

export default function EnhancedKanbanBoard({ items, onStatusChange, type, context }: EnhancedKanbanBoardProps) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [draggedOver, setDraggedOver] = useState<string | null>(null)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <AIProgressSummary items={items} />
        <div className="flex items-center gap-2">
          {(type === "prd" || type === "epic") && (
            <AIEpicStoryGenerator
              type={type === "prd" ? "epic" : "story"}
              context={context}
              onGenerate={(items) => {
                console.log("Generated items:", items)
              }}
            />
          )}
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-x-auto pb-4">
        {statusColumns[type].map((column) => (
          <div key={column.id} className="flex-shrink-0 w-80">
            <div className={`${column.color} rounded-lg p-3 mb-4`}>
              <h3 className="font-semibold text-gray-900 flex items-center justify-between">
                {column.title}
                <Badge variant="secondary" className="bg-white/50">
                  {getItemsByStatus(items, column.id).length}
                </Badge>
              </h3>
            </div>

            <div
              className={`min-h-[200px] space-y-3 p-2 rounded-lg transition-colors ${
                draggedOver === column.id ? "bg-blue-50 border-2 border-blue-300" : "bg-gray-50"
              }`}
              onDragOver={(e) => handleDragOver(e, column.id, setDraggedOver)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id, items, setDraggedItem, setDraggedOver, onStatusChange)}
            >
              {getItemsByStatus(items, column.id).map((item) => (
                <KanbanCard
                  key={item.id}
                  item={item}
                  draggedItem={draggedItem}
                  onDragStart={(e, itemId) => handleDragStart(e, itemId, setDraggedItem)}
                  onMouseEnter={() => setHoveredItem(item.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
