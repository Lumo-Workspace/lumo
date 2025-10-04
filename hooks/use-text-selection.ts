"use client"

import { useState, useEffect, useCallback } from "react"

interface SelectionState {
  isVisible: boolean
  position: { x: number; y: number }
  selectedText: string
}

export function useTextSelection() {
  const [selection, setSelection] = useState<SelectionState>({
    isVisible: false,
    position: { x: 0, y: 0 },
    selectedText: ""
  })

  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection()
    
    if (!selection || selection.rangeCount === 0) {
      setSelection(prev => ({ ...prev, isVisible: false }))
      return
    }

    const selectedText = selection.toString().trim()
    
    if (selectedText.length === 0) {
      setSelection(prev => ({ ...prev, isVisible: false }))
      return
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    
    // Check if selection is within an editable element (textarea or contenteditable)
    const editableElement = selection.anchorNode?.parentElement?.closest('textarea, [contenteditable="true"]')
    
    if (!editableElement) {
      setSelection(prev => ({ ...prev, isVisible: false }))
      return
    }

    setSelection({
      isVisible: true,
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top
      },
      selectedText
    })
  }, [])

  const hideMenu = useCallback(() => {
    setSelection(prev => ({ ...prev, isVisible: false }))
  }, [])

  useEffect(() => {
    const handleMouseUp = (e: Event) => {
      handleSelectionChange()
    }
    
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keyup', handleSelectionChange)
    document.addEventListener('click', hideMenu)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keyup', handleSelectionChange)
      document.removeEventListener('click', hideMenu)
    }
  }, [handleSelectionChange, hideMenu])

  return {
    selection,
    hideMenu
  }
}
