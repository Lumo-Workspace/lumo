"use client"

import type React from "react"

import { useState } from "react"
import type { Block, Page } from "./use-pages"

export function useBlocks(
  pages: Record<string, Page>,
  setPages: React.Dispatch<React.SetStateAction<Record<string, Page>>>,
  currentPageId: string,
) {
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashMenuPosition, setSlashMenuPosition] = useState({ x: 0, y: 0 })
  const [slashMenuSearch, setSlashMenuSearch] = useState("")
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null)

  const addNewBlock = (afterBlockId: string) => {
    const newBlockId = Date.now().toString()
    const newBlock: Block = { id: newBlockId, type: "paragraph", content: "" }
    const currentPage = pages[currentPageId]
    if (!currentPage) return newBlockId

    const blockIndex = currentPage.blocks.findIndex((b) => b.id === afterBlockId)
    const newBlocks = [...currentPage.blocks]
    newBlocks.splice(blockIndex + 1, 0, newBlock)

    setPages((prev) => ({
      ...prev,
      [currentPageId]: { ...currentPage, blocks: newBlocks },
    }))

    return newBlockId
  }

  const updateBlock = (blockId: string, content: string) => {
    const currentPage = pages[currentPageId]
    if (!currentPage) return

    const updatedBlocks = currentPage.blocks.map((block) => (block.id === blockId ? { ...block, content } : block))

    setPages((prev) => ({
      ...prev,
      [currentPageId]: { ...currentPage, blocks: updatedBlocks },
    }))

    // Update page title if it's the first heading block
    if (currentPage.blocks[0]?.id === blockId && currentPage.blocks[0]?.type === "heading1") {
      setPages((prev) => ({
        ...prev,
        [currentPageId]: { ...prev[currentPageId], title: content || "无标题" },
      }))
    }
  }

  const changeBlockType = (blockId: string, newType: Block["type"]) => {
    const currentPage = pages[currentPageId]
    if (!currentPage) return

    const updatedBlocks = currentPage.blocks.map((block) =>
      block.id === blockId ? { ...block, type: newType, content: "" } : block,
    )

    setPages((prev) => ({
      ...prev,
      [currentPageId]: { ...currentPage, blocks: updatedBlocks },
    }))
    setShowSlashMenu(false)
  }

  const toggleTodo = (blockId: string) => {
    const currentPage = pages[currentPageId]
    if (!currentPage) return

    const updatedBlocks = currentPage.blocks.map((block) =>
      block.id === blockId ? { ...block, completed: !block.completed } : block,
    )

    setPages((prev) => ({
      ...prev,
      [currentPageId]: { ...currentPage, blocks: updatedBlocks },
    }))
  }

  const deleteBlock = (blockId: string) => {
    const currentPage = pages[currentPageId]
    if (!currentPage) return

    const updatedBlocks = currentPage.blocks.filter((block) => block.id !== blockId)
    
    setPages((prev) => ({
      ...prev,
      [currentPageId]: { ...currentPage, blocks: updatedBlocks },
    }))
  }

  const handleKeyDown = (e: React.KeyboardEvent, blockId: string) => {
    console.log("[v0] Key pressed:", e.key, "Block ID:", blockId, "Focused Block:", focusedBlockId)

    if (e.key === "/") {
      console.log("[v0] Slash detected, focused block matches:", focusedBlockId === blockId)
      if (focusedBlockId === blockId) {
        const target = e.target as HTMLTextAreaElement
        const cursorPosition = target.selectionStart
        const textBeforeCursor = target.value.substring(0, cursorPosition)
        
        // Only show slash menu if cursor is at start of line or after whitespace
        if (cursorPosition === 0 || /^\s*$/.test(textBeforeCursor)) {
          e.preventDefault() // Prevent the / from being added to the text
          const rect = e.currentTarget.getBoundingClientRect()
          setSlashMenuPosition({ x: rect.left, y: rect.bottom })
          setActiveBlockId(blockId)
          setShowSlashMenu(true)
          console.log("[v0] Slash menu state set to true, position:", { x: rect.left, y: rect.bottom })
        }
      }
    } else if (e.key === "Enter" && !showSlashMenu) {
      e.preventDefault()
      const newBlockId = addNewBlock(blockId)
      setTimeout(() => {
        const newBlockElement = document.querySelector(`textarea[data-block-id="${newBlockId}"]`) as HTMLTextAreaElement
        if (newBlockElement) {
          newBlockElement.focus()
        }
      }, 10)
    } else if (e.key === "Backspace") {
      const currentPage = pages[currentPageId]
      if (!currentPage) return
      
      const block = currentPage.blocks.find((b) => b.id === blockId)
      const target = e.target as HTMLTextAreaElement
      const cursorPosition = target.selectionStart
      
      // If the block is empty and cursor is at the beginning, delete the block
      if (block?.content === "" && cursorPosition === 0 && currentPage.blocks.length > 1) {
        e.preventDefault()
        deleteBlock(blockId)
        
        // Focus the previous block after deletion
        const blockIndex = currentPage.blocks.findIndex((b) => b.id === blockId)
        if (blockIndex > 0) {
          const previousBlock = currentPage.blocks[blockIndex - 1]
          setTimeout(() => {
            const previousBlockElement = document.querySelector(`textarea[data-block-id="${previousBlock.id}"]`) as HTMLTextAreaElement
            if (previousBlockElement) {
              previousBlockElement.focus()
              // Move cursor to the end of the previous block
              previousBlockElement.setSelectionRange(previousBlockElement.value.length, previousBlockElement.value.length)
            }
          }, 10)
        }
      }
    } else if (e.key === "Escape") {
      setShowSlashMenu(false)
    }
  }

  const handleFocus = (blockId: string) => {
    console.log("[v0] Block focused:", blockId)
    setFocusedBlockId(blockId)
  }

  const handleBlur = (blockId: string) => {
    console.log("[v0] Block blurred:", blockId, "Show slash menu:", showSlashMenu)
    // Don't hide slash menu immediately on blur - let it be handled by click outside
    setFocusedBlockId(null)
  }

  return {
    showSlashMenu,
    setShowSlashMenu,
    slashMenuPosition,
    slashMenuSearch,
    setSlashMenuSearch,
    activeBlockId,
    focusedBlockId,
    addNewBlock,
    updateBlock,
    changeBlockType,
    toggleTodo,
    deleteBlock,
    handleKeyDown,
    handleFocus,
    handleBlur,
  }
}
