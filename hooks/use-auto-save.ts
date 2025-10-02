"use client"

import { useState, useCallback, useEffect } from "react"
import type { DocumentBlock } from "./use-document-blocks"

export function useAutoSave(blocks: DocumentBlock[], onSave?: (content: DocumentBlock[]) => void) {
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const autoSave = useCallback(async () => {
    if (!onSave) return

    setIsAutoSaving(true)
    try {
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 500))
      onSave(blocks)
      setLastSaved(new Date())
    } finally {
      setIsAutoSaving(false)
    }
  }, [blocks, onSave])

  // Auto-save when content changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (blocks.some((block) => block.content.trim() !== "")) {
        autoSave()
      }
    }, 2000) // Auto-save after 2 seconds of inactivity

    return () => clearTimeout(timer)
  }, [blocks, autoSave])

  return {
    isAutoSaving,
    lastSaved,
    autoSave,
  }
}
