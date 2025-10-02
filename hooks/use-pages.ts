"use client"

import { useState } from "react"

export interface Block {
  id: string
  type:
    | "heading1"
    | "heading2"
    | "heading3"
    | "paragraph"
    | "bulletList"
    | "numberedList"
    | "todo"
    | "quote"
    | "code"
    | "divider"
  content: string
  completed?: boolean
}

export interface Page {
  id: string
  title: string
  parentId?: string
  children: string[]
  blocks: Block[]
  isExpanded?: boolean
}

const initialPages: Record<string, Page> = {
  "1": {
    id: "1",
    title: "无标题",
    children: ["2", "3"],
    blocks: [
      { id: "1", type: "heading1", content: "无标题" },
      { id: "2", type: "paragraph", content: "" },
    ],
    isExpanded: true,
  },
  "2": {
    id: "2",
    title: "项目计划",
    parentId: "1",
    children: ["4"],
    blocks: [
      { id: "1", type: "heading1", content: "项目计划" },
      { id: "2", type: "paragraph", content: "这是项目计划的详细内容..." },
    ],
    isExpanded: false,
  },
  "3": {
    id: "3",
    title: "会议记录",
    parentId: "1",
    children: [],
    blocks: [
      { id: "1", type: "heading1", content: "会议记录" },
      { id: "2", type: "paragraph", content: "今天的会议讨论了..." },
    ],
  },
  "4": {
    id: "4",
    title: "技术规范",
    parentId: "2",
    children: [],
    blocks: [
      { id: "1", type: "heading1", content: "技术规范" },
      { id: "2", type: "paragraph", content: "技术实现的详细规范..." },
    ],
  },
}

export function usePages() {
  const [pages, setPages] = useState<Record<string, Page>>(initialPages)
  const [currentPageId, setCurrentPageId] = useState<string>("1")

  const getCurrentPage = () => pages[currentPageId]
  const getCurrentBlocks = () => getCurrentPage()?.blocks || []

  const togglePageExpansion = (pageId: string) => {
    setPages((prev) => ({
      ...prev,
      [pageId]: { ...prev[pageId], isExpanded: !prev[pageId].isExpanded },
    }))
  }

  const expandPathToPage = (targetPageId: string) => {
    const getPathToRoot = (pageId: string): string[] => {
      const path: string[] = []
      let currentId = pageId

      while (currentId && pages[currentId]) {
        const page = pages[currentId]
        if (page.parentId) {
          path.unshift(page.parentId)
          currentId = page.parentId
        } else {
          break
        }
      }

      return path
    }

    const pathToExpand = getPathToRoot(targetPageId)

    setPages((prev) => {
      const updated = { ...prev }
      pathToExpand.forEach((pageId) => {
        if (updated[pageId]) {
          updated[pageId] = { ...updated[pageId], isExpanded: true }
        }
      })
      return updated
    })
  }

  const createNewPage = (parentId?: string) => {
    const newPageId = Date.now().toString()
    const newPage: Page = {
      id: newPageId,
      title: "无标题",
      parentId,
      children: [],
      blocks: [
        { id: "1", type: "heading1", content: "无标题" },
        { id: "2", type: "paragraph", content: "" },
      ],
    }

    setPages((prev) => {
      const updated = { ...prev, [newPageId]: newPage }
      if (parentId && updated[parentId]) {
        updated[parentId] = {
          ...updated[parentId],
          children: [...updated[parentId].children, newPageId],
          isExpanded: true,
        }
      }
      return updated
    })
    setCurrentPageId(newPageId)
  }

  const updatePageTitle = (pageId: string, title: string) => {
    setPages((prev) => ({
      ...prev,
      [pageId]: {
        ...prev[pageId],
        title: title.trim(),
        blocks: prev[pageId].blocks.map((block, index) =>
          index === 0 && block.type === "heading1" ? { ...block, content: title.trim() } : block,
        ),
      },
    }))
  }

  const deletePage = (pageId: string) => {
    setPages((prev) => {
      const updated = { ...prev }
      const pageToDelete = updated[pageId]

      if (pageToDelete.parentId && updated[pageToDelete.parentId]) {
        updated[pageToDelete.parentId] = {
          ...updated[pageToDelete.parentId],
          children: updated[pageToDelete.parentId].children.filter((id) => id !== pageId),
        }
      }

      const deletePageAndChildren = (id: string) => {
        const page = updated[id]
        if (page) {
          page.children.forEach((childId) => deletePageAndChildren(childId))
          delete updated[id]
        }
      }

      deletePageAndChildren(pageId)
      return updated
    })

    if (currentPageId === pageId) {
      const remainingPages = Object.keys(pages).filter((id) => id !== pageId)
      if (remainingPages.length > 0) {
        setCurrentPageId(remainingPages[0])
      }
    }
  }

  return {
    pages,
    currentPageId,
    setCurrentPageId,
    getCurrentPage,
    getCurrentBlocks,
    togglePageExpansion,
    expandPathToPage,
    createNewPage,
    updatePageTitle,
    deletePage,
    setPages, // Added setPages to the return object so useBlocks can update page state
  }
}
