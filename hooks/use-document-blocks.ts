'use client'

import type React from 'react'

import { useState, useCallback } from 'react'

export interface TaskWidget {
  id: string
  title: string
  status: 'draft' | 'active' | 'in-review' | 'blocked' | 'completed'
  assignee?: string
  dueDate?: Date
  priority: 'low' | 'medium' | 'high'
}

export interface DocumentBlock {
  id: string
  type: 'text' | 'task'
  content: string
  task?: TaskWidget
}

export function useDocumentBlocks(initialContent: DocumentBlock[] = []) {
  const [blocks, setBlocks] = useState<DocumentBlock[]>(
    initialContent.length > 0
      ? initialContent
      : [{ id: '1', type: 'text', content: '' }]
  )
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)

  const updateBlockContent = useCallback((blockId: string, content: string) => {
    setBlocks(prev =>
      prev.map(block => (block.id === blockId ? { ...block, content } : block))
    )
  }, [])

  const addTextBlock = useCallback(
    (afterBlockId?: string) => {
      const newBlock: DocumentBlock = {
        id: Date.now().toString(),
        type: 'text',
        content: '',
      }

      if (afterBlockId) {
        const index = blocks.findIndex(block => block.id === afterBlockId)
        setBlocks(prev => [
          ...prev.slice(0, index + 1),
          newBlock,
          ...prev.slice(index + 1),
        ])
      } else {
        setBlocks(prev => [...prev, newBlock])
      }

      setActiveBlockId(newBlock.id)
    },
    [blocks]
  )

  const addTaskBlock = useCallback((taskData: TaskWidget) => {
    const newBlock: DocumentBlock = {
      id: Date.now().toString() + '_block',
      type: 'task',
      content: '',
      task: taskData,
    }
    setBlocks(prev => [...prev, newBlock])
  }, [])

  const updateTaskBlock = useCallback((taskData: TaskWidget) => {
    setBlocks(prev =>
      prev.map(block =>
        block.task?.id === taskData.id ? { ...block, task: taskData } : block
      )
    )
  }, [])

  const deleteBlock = useCallback(
    (blockId: string) => {
      setBlocks(prev => prev.filter(block => block.id !== blockId))

      // Focus previous block
      const currentIndex = blocks.findIndex(b => b.id === blockId)
      if (currentIndex > 0) {
        const previousBlock = blocks[currentIndex - 1]
        if (previousBlock) {
          setActiveBlockId(previousBlock.id)
        }
      }
    },
    [blocks]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, blockId: string) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        addTextBlock(blockId)
      }

      if (e.key === 'Backspace') {
        const block = blocks.find(b => b.id === blockId)
        if (block?.content === '' && blocks.length > 1) {
          e.preventDefault()
          deleteBlock(blockId)
        }
      }
    },
    [blocks, addTextBlock, deleteBlock]
  )

  return {
    blocks,
    activeBlockId,
    setActiveBlockId,
    updateBlockContent,
    addTextBlock,
    addTaskBlock,
    updateTaskBlock,
    deleteBlock,
    handleKeyDown,
  }
}
