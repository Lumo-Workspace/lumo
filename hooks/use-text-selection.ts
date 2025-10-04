"use client"

import { useState, useEffect, useCallback } from "react"

interface SelectionState {
  isVisible: boolean
  position: { x: number; y: number }
  selectedText: string
}

export function useTextSelection() {
  console.log('=== useTextSelection Hook Initialized ===')
  
  const [selection, setSelection] = useState<SelectionState>({
    isVisible: false,
    position: { x: 0, y: 0 },
    selectedText: ""
  })

  // 直接测试事件监听器
  console.log('About to set up useEffect...')

  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection()
    
    console.log('Selection change detected:', selection)
    
    if (!selection || selection.rangeCount === 0) {
      console.log('No selection or no ranges')
      setSelection(prev => ({ ...prev, isVisible: false }))
      return
    }

    const selectedText = selection.toString().trim()
    console.log('Selected text:', selectedText)
    
    if (selectedText.length === 0) {
      console.log('No selected text')
      setSelection(prev => ({ ...prev, isVisible: false }))
      return
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    
    // Check if selection is within an editable element (textarea or contenteditable)
    const editableElement = selection.anchorNode?.parentElement?.closest('textarea, [contenteditable="true"]')
    console.log('Editable element:', editableElement)
    
    if (!editableElement) {
      console.log('Not within editable element')
      setSelection(prev => ({ ...prev, isVisible: false }))
      return
    }

    console.log('Showing floating menu at position:', rect.left + rect.width / 2, rect.top)

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
    console.log('Setting up text selection listeners')
    
    const handleMouseUp = (e: Event) => {
      console.log('Mouse up event fired')
      handleSelectionChange()
    }
    
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keyup', handleSelectionChange)
    document.addEventListener('click', hideMenu)

    return () => {
      console.log('Cleaning up text selection listeners')
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keyup', handleSelectionChange)
      document.removeEventListener('click', hideMenu)
    }
  }, []) // 移除依赖项

  return {
    selection,
    hideMenu
  }
}
