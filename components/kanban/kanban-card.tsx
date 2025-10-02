"use client"

import type React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { type EnhancedKanbanItem, getPriorityColor, getPriorityLabel } from "@/utils/kanban-utils"
import DependencyTooltip from "./dependency-tooltip"
import StoryOptimizationPanel from "../story-optimization-panel"

interface KanbanCardProps {
  item: EnhancedKanbanItem
  draggedItem: string | null
  onDragStart: (e: React.DragEvent, itemId: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export default function KanbanCard({ item, draggedItem, onDragStart, onMouseEnter, onMouseLeave }: KanbanCardProps) {
  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e, item.id)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`cursor-grab active:cursor-grabbing transition-all relative ${
        draggedItem === item.id ? "opacity-50 scale-95" : "shadow-sm hover:shadow-md"
      } ${item.blockedBy?.length ? "border-l-4 border-l-red-500" : ""}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-gray-900 line-clamp-2 pr-6">{item.title}</CardTitle>
        <DependencyTooltip item={item} />
      </CardHeader>
      <CardContent className="pt-0">
        {item.content && <p className="text-xs text-gray-600 mb-3 line-clamp-2">{item.content}</p>}

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {item.priority && (
              <Badge className={`text-xs ${getPriorityColor(item.priority)} border-0`}>
                {getPriorityLabel(item.priority)}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {item.type.toUpperCase()}
            </Badge>
            {item.aiSuggestions && item.aiSuggestions > 0 && (
              <Badge className="bg-purple-100 text-purple-800 text-xs border-0">🧠 {item.aiSuggestions}</Badge>
            )}
          </div>
        </div>

        {item.type === "story" && (
          <div className="mb-2">
            <StoryOptimizationPanel
              storyId={item.id}
              storyTitle={item.title}
              storyContent={item.content || ""}
              onApplyOptimization={(optimizations) => {
                console.log("Applied optimizations:", optimizations)
              }}
            />
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2">
            {item.assignee && (
              <div className="flex items-center gap-1">
                <span>👤</span>
                <span>{item.assignee}</span>
              </div>
            )}
            {item.dueDate && (
              <div className="flex items-center gap-1">
                <span>📅</span>
                <span>{new Date(item.dueDate).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-400">
          更新: {new Date(item.updatedAt).toLocaleDateString()}
          {item.lastAIReview && <span className="ml-2 text-purple-600">🧠 {item.lastAIReview}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
