"use client"
import { ChevronRight } from "lucide-react"

interface Page {
  id: string
  title: string
  parentId?: string
  children: string[]
}

interface BreadcrumbProps {
  pages: Record<string, Page>
  currentPageId: string
  onPageClick: (pageId: string) => void
}

export default function Breadcrumb({ pages, currentPageId, onPageClick }: BreadcrumbProps) {
  const getBreadcrumbPath = (pageId: string): Page[] => {
    const path: Page[] = []
    let currentPage = pages[pageId]

    while (currentPage) {
      path.unshift(currentPage)
      if (currentPage.parentId) {
        currentPage = pages[currentPage.parentId]
      } else {
        break
      }
    }

    return path
  }

  const path = getBreadcrumbPath(currentPageId)

  return (
    <div className="h-12 border-b border-gray-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-sm text-gray-600">
          {path.map((page, index, array) => (
            <div key={page.id} className="flex items-center gap-1">
              <button onClick={() => onPageClick(page.id)} className="hover:text-gray-900 transition-colors">
                {page.title}
              </button>
              {index < array.length - 1 && <ChevronRight className="w-3 h-3 text-gray-400" />}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 transition-colors">分享</button>
        <button className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 transition-colors">更新</button>
      </div>
    </div>
  )
}
