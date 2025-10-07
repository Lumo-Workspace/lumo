'use client'

import { useState, useCallback } from 'react'
import type { Block, Page } from './use-pages'

interface UseBlocksProps {
  pages: Record<string, Page>
  setPages: React.Dispatch<React.SetStateAction<Record<string, Page>>>
  currentPageId: string
}

interface SlashMenuState {
  isVisible: boolean
  position: { x: number; y: number }
  searchQuery: string
}

interface BlockState {
  activeBlockId: string | null
  focusedBlockId: string | null
}

export function useBlocks({ pages, setPages, currentPageId }: UseBlocksProps) {
  // Slash菜单状态
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>({
    isVisible: false,
    position: { x: 0, y: 0 },
    searchQuery: '',
  })

  // 块状态
  const [blockState, setBlockState] = useState<BlockState>({
    activeBlockId: null,
    focusedBlockId: null,
  })

  // 创建新块
  const addNewBlock = useCallback(
    (afterBlockId: string): string => {
      const newBlockId = Date.now().toString()
      const newBlock: Block = {
        id: newBlockId,
        type: 'paragraph',
        content: '',
      }

      const currentPage = pages[currentPageId]
      if (!currentPage) return newBlockId

      const blockIndex = currentPage.blocks.findIndex(
        b => b.id === afterBlockId
      )
      const newBlocks = [...currentPage.blocks]
      newBlocks.splice(blockIndex + 1, 0, newBlock)

      setPages(prev => ({
        ...prev,
        [currentPageId]: { ...currentPage, blocks: newBlocks },
      }))

      return newBlockId
    },
    [pages, currentPageId, setPages]
  )

  // 更新块内容
  const updateBlock = useCallback(
    (blockId: string, content: string): void => {
      const currentPage = pages[currentPageId]
      if (!currentPage) return

      const updatedBlocks = currentPage.blocks.map(block =>
        block.id === blockId ? { ...block, content } : block
      )

      setPages(prev => ({
        ...prev,
        [currentPageId]: { ...currentPage, blocks: updatedBlocks },
      }))

      // 如果是第一个标题块，更新页面标题
      if (
        currentPage.blocks[0]?.id === blockId &&
        currentPage.blocks[0]?.type === 'heading1'
      ) {
        setPages(prev => ({
          ...prev,
          [currentPageId]: {
            ...prev[currentPageId]!,
            title: content || '无标题',
          },
        }))
      }
    },
    [pages, currentPageId, setPages]
  )

  // 更改块类型
  const changeBlockType = useCallback(
    (blockId: string, newType: Block['type']): void => {
      const currentPage = pages[currentPageId]
      if (!currentPage) return

      const updatedBlocks = currentPage.blocks.map(block =>
        block.id === blockId ? { ...block, type: newType, content: '' } : block
      )

      setPages(prev => ({
        ...prev,
        [currentPageId]: { ...currentPage, blocks: updatedBlocks },
      }))

      setSlashMenu(prev => ({ ...prev, isVisible: false }))

      // 强制重新渲染以应用新样式
      setTimeout(() => {
        const textareaElement = document.querySelector(
          `textarea[data-block-id="${blockId}"]`
        ) as HTMLTextAreaElement
        if (textareaElement) {
          // 重置样式
          textareaElement.style.height = 'auto'
          textareaElement.style.minHeight = '1.5rem'
          // 重新计算高度
          textareaElement.style.height = textareaElement.scrollHeight + 'px'
        }
      }, 10)
    },
    [pages, currentPageId, setPages]
  )

  // 切换待办事项状态
  const toggleTodo = useCallback(
    (blockId: string): void => {
      const currentPage = pages[currentPageId]
      if (!currentPage) return

      const updatedBlocks = currentPage.blocks.map(block =>
        block.id === blockId ? { ...block, completed: !block.completed } : block
      )

      setPages(prev => ({
        ...prev,
        [currentPageId]: { ...currentPage, blocks: updatedBlocks },
      }))
    },
    [pages, currentPageId, setPages]
  )

  // 删除块
  const deleteBlock = useCallback(
    (blockId: string): void => {
      const currentPage = pages[currentPageId]
      if (!currentPage) return

      const updatedBlocks = currentPage.blocks.filter(
        block => block.id !== blockId
      )

      setPages(prev => ({
        ...prev,
        [currentPageId]: { ...currentPage, blocks: updatedBlocks },
      }))
    },
    [pages, currentPageId, setPages]
  )

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, blockId: string): void => {
      // 允许箭头键正常移动光标
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        return // 不阻止默认行为
      }

      // 允许撤销/重做快捷键
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            if (!e.shiftKey) {
              // Command+Z (撤销) - 让浏览器处理
              return
            } else {
              // Command+Shift+Z (重做) - 让浏览器处理
              return
            }
          case 'y':
            // Command+Y (重做) - 让浏览器处理
            return
        }
      }

      if (e.key === '/') {
        if (blockState.focusedBlockId === blockId) {
          const target = e.target as HTMLTextAreaElement
          const cursorPosition = target.selectionStart
          const textBeforeCursor = target.value.substring(0, cursorPosition)

          // 只有在行首或空白字符后才显示斜杠菜单
          if (cursorPosition === 0 || /^\s*$/.test(textBeforeCursor)) {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setSlashMenu(prev => ({
              ...prev,
              isVisible: true,
              position: { x: rect.left, y: rect.bottom },
            }))
            setBlockState(prev => ({ ...prev, activeBlockId: blockId }))
          }
        }
      } else if (e.key === 'Enter' && !slashMenu.isVisible) {
        e.preventDefault()
        const newBlockId = addNewBlock(blockId)
        setTimeout(() => {
          const newBlockElement = document.querySelector(
            `textarea[data-block-id="${newBlockId}"]`
          ) as HTMLTextAreaElement
          if (newBlockElement) {
            newBlockElement.focus()
          }
        }, 10)
      } else if (e.key === 'Backspace') {
        const currentPage = pages[currentPageId]
        if (!currentPage) return

        const block = currentPage.blocks.find(b => b.id === blockId)
        const target = e.target as HTMLTextAreaElement
        const cursorPosition = target.selectionStart

        // 如果块为空且光标在开头，删除块
        if (
          block?.content === '' &&
          cursorPosition === 0 &&
          currentPage.blocks.length > 1
        ) {
          e.preventDefault()
          deleteBlock(blockId)

          // 删除后聚焦到前一个块
          const blockIndex = currentPage.blocks.findIndex(b => b.id === blockId)
          if (blockIndex > 0) {
            const previousBlock = currentPage.blocks[blockIndex - 1]
            if (previousBlock) {
              setTimeout(() => {
                const previousBlockElement = document.querySelector(
                  `textarea[data-block-id="${previousBlock.id}"]`
                ) as HTMLTextAreaElement
                if (previousBlockElement) {
                  previousBlockElement.focus()
                  previousBlockElement.setSelectionRange(
                    previousBlockElement.value.length,
                    previousBlockElement.value.length
                  )
                }
              }, 10)
            }
          }
        }
      } else if (e.key === 'Escape') {
        setSlashMenu(prev => ({ ...prev, isVisible: false }))
      }
    },
    [
      blockState.focusedBlockId,
      slashMenu.isVisible,
      pages,
      currentPageId,
      addNewBlock,
      deleteBlock,
    ]
  )

  // 处理焦点事件
  const handleFocus = useCallback((blockId: string): void => {
    setBlockState(prev => ({ ...prev, focusedBlockId: blockId }))
  }, [])

  const handleBlur = useCallback((): void => {
    setBlockState(prev => ({ ...prev, focusedBlockId: null }))
  }, [])

  return {
    // Slash菜单相关
    showSlashMenu: slashMenu.isVisible,
    setShowSlashMenu: (visible: boolean) =>
      setSlashMenu(prev => ({ ...prev, isVisible: visible })),
    slashMenuPosition: slashMenu.position,
    slashMenuSearch: slashMenu.searchQuery,
    setSlashMenuSearch: (query: string) =>
      setSlashMenu(prev => ({ ...prev, searchQuery: query })),

    // 块状态
    activeBlockId: blockState.activeBlockId,
    focusedBlockId: blockState.focusedBlockId,

    // 块操作方法
    addNewBlock,
    updateBlock,
    changeBlockType,
    toggleTodo,
    deleteBlock,

    // 事件处理器
    handleKeyDown,
    handleFocus,
    handleBlur,
  }
}
