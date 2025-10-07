'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  FileText,
  Hash,
  List,
  CheckSquare,
  Code,
  Quote,
  Divide,
  GitBranch,
} from 'lucide-react'
import type { Block } from '../hooks/use-pages'

// 块类型配置
const blockTypes = [
  {
    type: 'paragraph',
    label: '文本',
    icon: FileText,
    description: '开始写作，使用纯文本。',
  },
  {
    type: 'heading1',
    label: '标题 1',
    icon: Hash,
    description: '大号标题。',
  },
  {
    type: 'heading2',
    label: '标题 2',
    icon: Hash,
    description: '中号标题。',
  },
  {
    type: 'heading3',
    label: '标题 3',
    icon: Hash,
    description: '小号标题。',
  },
  {
    type: 'bulletList',
    label: '项目符号列表',
    icon: List,
    description: '创建一个简单的项目符号列表。',
  },
  {
    type: 'numberedList',
    label: '编号列表',
    icon: List,
    description: '创建一个编号列表。',
  },
  {
    type: 'todo',
    label: '待办事项',
    icon: CheckSquare,
    description: '跟踪任务的待办事项列表。',
  },
  {
    type: 'quote',
    label: '引用',
    icon: Quote,
    description: '捕获引用。',
  },
  {
    type: 'code',
    label: '代码',
    icon: Code,
    description: '捕获代码片段。',
  },
  {
    type: 'mermaid',
    label: '流程图',
    icon: GitBranch,
    description: '创建 Mermaid 流程图和图表。',
  },
  {
    type: 'divider',
    label: '分割线',
    icon: Divide,
    description: '在视觉上分割块。',
  },
]

interface SlashMenuProps {
  show: boolean
  position: { x: number; y: number }
  searchQuery: string
  onSearchChange: (query: string) => void
  onBlockTypeSelect: (type: Block['type']) => void
  onClose?: () => void
}

export default function SlashMenu({
  show,
  position,
  searchQuery,
  onSearchChange,
  onBlockTypeSelect,
  onClose,
}: SlashMenuProps) {
  if (!show) return null

  // 过滤块类型
  const filteredBlockTypes = blockTypes.filter(
    blockType =>
      blockType.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      blockType.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 处理块类型选择
  const handleBlockTypeSelect = (type: Block['type']) => {
    onBlockTypeSelect(type)
    onClose?.()
  }

  return (
    <div
      className='slash-menu fixed z-50 w-80'
      style={{ left: position.x, top: position.y }}
    >
      <Command className='bg-white border border-gray-200 rounded-lg shadow-lg'>
        <CommandInput
          placeholder='搜索块类型...'
          value={searchQuery}
          onValueChange={onSearchChange}
          className='h-8'
        />
        <CommandList className='max-h-64'>
          <CommandEmpty>未找到匹配的块类型</CommandEmpty>
          <CommandGroup>
            {filteredBlockTypes.map(blockType => {
              const IconComponent = blockType.icon
              return (
                <CommandItem
                  key={blockType.type}
                  onSelect={() =>
                    handleBlockTypeSelect(blockType.type as Block['type'])
                  }
                  className='flex items-center gap-3 px-3 py-2 cursor-pointer'
                >
                  <IconComponent className='w-4 h-4 text-gray-600' />
                  <div className='flex-1'>
                    <div className='font-medium text-sm text-gray-900'>
                      {blockType.label}
                    </div>
                    <div className='text-xs text-gray-600'>
                      {blockType.description}
                    </div>
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}
