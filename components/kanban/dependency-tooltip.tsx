"use client"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { EnhancedKanbanItem } from "@/utils/kanban-utils"

interface DependencyTooltipProps {
  item: EnhancedKanbanItem
}

export default function DependencyTooltip({ item }: DependencyTooltipProps) {
  if (!item.dependencies?.length && !item.blockedBy?.length) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs cursor-help">
            🔗
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-2">
            {item.dependencies?.length > 0 && (
              <div>
                <p className="font-medium text-sm">依赖项:</p>
                <ul className="text-xs space-y-1">
                  {item.dependencies.map((dep, index) => (
                    <li key={index} className="flex items-center gap-1">
                      <span className="text-blue-500">→</span>
                      {dep}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.blockedBy?.length > 0 && (
              <div>
                <p className="font-medium text-sm text-red-600">被阻塞:</p>
                <ul className="text-xs space-y-1">
                  {item.blockedBy.map((blocker, index) => (
                    <li key={index} className="flex items-center gap-1">
                      <span className="text-red-500">⚠️</span>
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
