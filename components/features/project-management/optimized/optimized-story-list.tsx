/**
 * 优化的故事列表组件
 * Optimized Story List Component
 */

'use client'

import React, { memo, useMemo, useCallback, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Search,
  Filter,
  SortAsc,
  SortDesc,
  Grid3X3,
  List,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { cn, debounce } from '@/utils'
import { OptimizedStoryCard } from './optimized-story-card'
import type { Story, Priority, StoryStatus } from '@/types'

interface StoryListProps {
  stories: Story[]
  loading?: boolean
  onStoryEdit?: (story: Story) => void
  onStoryDelete?: (story: Story) => void
  onStoryDuplicate?: (story: Story) => void
  onStoryStatusChange?: (story: Story, status: StoryStatus) => void
  onStoryPriorityChange?: (story: Story, priority: Priority) => void
  onStoryAssigneeChange?: (story: Story, assignee: string) => void
  onStoryCreate?: () => void
  onRefresh?: () => void
  className?: string
}

type ViewMode = 'grid' | 'list'
type SortField =
  | 'title'
  | 'priority'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'estimatedPoints'
type SortDirection = 'asc' | 'desc'

// 过滤和排序状态
interface FilterState {
  search: string
  status: StoryStatus | 'all'
  priority: Priority | 'all'
  assignee: string | 'all'
  tags: string[]
}

interface SortState {
  field: SortField
  direction: SortDirection
}

// 优化的故事列表组件
export const OptimizedStoryList = memo<StoryListProps>(
  ({
    stories,
    loading = false,
    onStoryEdit,
    onStoryDelete,
    onStoryDuplicate,
    onStoryCreate,
    onRefresh,
    className,
  }) => {
    // 状态管理
    const [viewMode, setViewMode] = useState<ViewMode>('grid')
    const [filter, setFilter] = useState<FilterState>({
      search: '',
      status: 'all',
      priority: 'all',
      assignee: 'all',
      tags: [],
    })
    const [sort, setSort] = useState<SortState>({
      field: 'createdAt',
      direction: 'desc',
    })
    const [showFilters, setShowFilters] = useState(false)

    // 计算过滤后的故事列表
    const filteredStories = useMemo(() => {
      let result = [...stories]

      // 搜索过滤
      if (filter.search) {
        const searchLower = filter.search.toLowerCase()
        result = result.filter(
          story =>
            story.title.toLowerCase().includes(searchLower) ||
            story.asA.toLowerCase().includes(searchLower) ||
            story.iWant.toLowerCase().includes(searchLower) ||
            story.soThat.toLowerCase().includes(searchLower) ||
            story.acceptanceCriteria.some(criteria =>
              criteria.toLowerCase().includes(searchLower)
            )
        )
      }

      // 状态过滤
      if (filter.status !== 'all') {
        result = result.filter(story => story.status === filter.status)
      }

      // 优先级过滤
      if (filter.priority !== 'all') {
        result = result.filter(story => story.priority === filter.priority)
      }

      // 负责人过滤
      if (filter.assignee !== 'all') {
        result = result.filter(story => story.assignee === filter.assignee)
      }

      // 标签过滤
      if (filter.tags.length > 0) {
        result = result.filter(story =>
          filter.tags.some(tag => story.tags.includes(tag))
        )
      }

      return result
    }, [stories, filter])

    // 计算排序后的故事列表
    const sortedStories = useMemo(() => {
      const result = [...filteredStories]

      result.sort((a, b) => {
        let aValue: any
        let bValue: any

        switch (sort.field) {
          case 'title':
            aValue = a.title.toLowerCase()
            bValue = b.title.toLowerCase()
            break
          case 'priority':
            const priorityOrder = { low: 1, medium: 2, high: 3, critical: 4 }
            aValue = priorityOrder[a.priority]
            bValue = priorityOrder[b.priority]
            break
          case 'status':
            const statusOrder = {
              backlog: 1,
              ready: 2,
              'in-progress': 3,
              review: 4,
              done: 5,
            }
            aValue = statusOrder[a.status]
            bValue = statusOrder[b.status]
            break
          case 'createdAt':
            aValue = new Date(a.createdAt).getTime()
            bValue = new Date(b.createdAt).getTime()
            break
          case 'updatedAt':
            aValue = new Date(a.updatedAt).getTime()
            bValue = new Date(b.updatedAt).getTime()
            break
          case 'estimatedPoints':
            aValue = a.estimatedPoints
            bValue = b.estimatedPoints
            break
          default:
            return 0
        }

        if (aValue < bValue) return sort.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sort.direction === 'asc' ? 1 : -1
        return 0
      })

      return result
    }, [filteredStories, sort])

    // 获取所有唯一值用于过滤器选项
    const filterOptions = useMemo(() => {
      const statuses = [...new Set(stories.map(s => s.status))] as StoryStatus[]
      const priorities = [
        ...new Set(stories.map(s => s.priority)),
      ] as Priority[]
      const assignees = [
        ...new Set(stories.map(s => s.assignee).filter(Boolean)),
      ]
      const tags = [...new Set(stories.flatMap(s => s.tags))]

      return { statuses, priorities, assignees, tags }
    }, [stories])

    // 事件处理器
    const handleSearchChange = useCallback(
      debounce((value: string) => {
        setFilter(prev => ({ ...prev, search: value }))
      }, 300),
      []
    )

    const handleFilterChange = useCallback(
      (key: keyof FilterState, value: any) => {
        setFilter(prev => ({ ...prev, [key]: value }))
      },
      []
    )

    const handleSortChange = useCallback((field: SortField) => {
      setSort(prev => ({
        field,
        direction:
          prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
      }))
    }, [])

    const clearFilters = useCallback(() => {
      setFilter({
        search: '',
        status: 'all',
        priority: 'all',
        assignee: 'all',
        tags: [],
      })
    }, [])

    // 渲染搜索栏
    const renderSearchBar = () => (
      <div className='flex items-center gap-2 mb-4'>
        <div className='relative flex-1'>
          <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400' />
          <Input
            placeholder='搜索故事...'
            className='pl-10'
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className='h-4 w-4 mr-2' />
          过滤器
        </Button>
        <div className='flex items-center gap-1'>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'outline'}
            size='sm'
            onClick={() => setViewMode('grid')}
          >
            <Grid3X3 className='h-4 w-4' />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            size='sm'
            onClick={() => setViewMode('list')}
          >
            <List className='h-4 w-4' />
          </Button>
        </div>
      </div>
    )

    // 渲染过滤器
    const renderFilters = () => {
      if (!showFilters) return null

      return (
        <Card className='mb-4'>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm'>过滤器</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
              <Select
                value={filter.status}
                onValueChange={value => handleFilterChange('status', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder='状态' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>所有状态</SelectItem>
                  {filterOptions.statuses.map(status => (
                    <SelectItem key={status} value={status}>
                      {status.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filter.priority}
                onValueChange={value => handleFilterChange('priority', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder='优先级' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>所有优先级</SelectItem>
                  {filterOptions.priorities.map(priority => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filter.assignee}
                onValueChange={value => handleFilterChange('assignee', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder='负责人' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>所有负责人</SelectItem>
                  {filterOptions.assignees
                    .filter(assignee => assignee)
                    .map(assignee => (
                      <SelectItem key={assignee!} value={assignee!}>
                        {assignee}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className='flex items-center gap-2'>
              <Button variant='outline' size='sm' onClick={clearFilters}>
                清除过滤器
              </Button>
              <div className='flex-1' />
              <Badge variant='secondary'>{sortedStories.length} 个故事</Badge>
            </div>
          </CardContent>
        </Card>
      )
    }

    // 渲染排序控件
    const renderSortControls = () => (
      <div className='flex items-center gap-2 mb-4'>
        <span className='text-sm text-gray-600'>排序:</span>
        <div className='flex items-center gap-1'>
          {(
            [
              'title',
              'priority',
              'status',
              'createdAt',
              'updatedAt',
              'estimatedPoints',
            ] as SortField[]
          ).map(field => (
            <Button
              key={field}
              variant={sort.field === field ? 'default' : 'outline'}
              size='sm'
              onClick={() => handleSortChange(field)}
            >
              {field === 'createdAt'
                ? '创建时间'
                : field === 'updatedAt'
                  ? '更新时间'
                  : field === 'estimatedPoints'
                    ? '估点'
                    : field}
              {sort.field === field &&
                (sort.direction === 'asc' ? (
                  <SortAsc className='h-3 w-3 ml-1' />
                ) : (
                  <SortDesc className='h-3 w-3 ml-1' />
                ))}
            </Button>
          ))}
        </div>
      </div>
    )

    // 渲染网格视图
    const renderGridView = () => (
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
        {sortedStories.map(story => (
          <OptimizedStoryCard
            key={story.id}
            story={story}
            onEdit={onStoryEdit || (() => {})}
            onDelete={onStoryDelete || (() => {})}
            onDuplicate={onStoryDuplicate || (() => {})}
            className='h-fit'
          />
        ))}
      </div>
    )

    // 渲染列表视图
    const renderListView = () => (
      <div className='space-y-3'>
        {sortedStories.map(story => (
          <OptimizedStoryCard
            key={story.id}
            story={story}
            onEdit={onStoryEdit || (() => {})}
            onDelete={onStoryDelete || (() => {})}
            onDuplicate={onStoryDuplicate || (() => {})}
            compact
          />
        ))}
      </div>
    )

    // 渲染空状态
    const renderEmptyState = () => (
      <div className='text-center py-12'>
        <div className='text-gray-400 mb-4'>
          <Search className='h-12 w-12 mx-auto' />
        </div>
        <h3 className='text-lg font-medium text-gray-900 mb-2'>没有找到故事</h3>
        <p className='text-gray-500 mb-4'>
          {filter.search ||
          filter.status !== 'all' ||
          filter.priority !== 'all' ||
          filter.assignee !== 'all'
            ? '尝试调整搜索条件或过滤器'
            : '开始创建你的第一个用户故事'}
        </p>
        {onStoryCreate && (
          <Button onClick={onStoryCreate}>
            <Plus className='h-4 w-4 mr-2' />
            创建故事
          </Button>
        )}
      </div>
    )

    // 渲染加载状态
    const renderLoadingState = () => (
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className='animate-pulse'>
            <CardHeader className='space-y-3'>
              <div className='h-4 bg-gray-200 rounded w-3/4' />
              <div className='flex gap-2'>
                <div className='h-6 bg-gray-200 rounded w-16' />
                <div className='h-6 bg-gray-200 rounded w-20' />
              </div>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='space-y-2'>
                <div className='h-3 bg-gray-200 rounded w-full' />
                <div className='h-3 bg-gray-200 rounded w-2/3' />
              </div>
              <div className='h-2 bg-gray-200 rounded w-full' />
            </CardContent>
          </Card>
        ))}
      </div>
    )

    return (
      <div className={cn('space-y-4', className)}>
        {/* 顶部操作栏 */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <h2 className='text-xl font-semibold'>用户故事</h2>
            <Badge variant='secondary'>{sortedStories.length}</Badge>
          </div>
          <div className='flex items-center gap-2'>
            {onRefresh && (
              <Button variant='outline' size='sm' onClick={onRefresh}>
                <RefreshCw className='h-4 w-4' />
              </Button>
            )}
            {onStoryCreate && (
              <Button onClick={onStoryCreate}>
                <Plus className='h-4 w-4 mr-2' />
                创建故事
              </Button>
            )}
          </div>
        </div>

        {/* 搜索和过滤器 */}
        {renderSearchBar()}
        {renderFilters()}
        {renderSortControls()}

        {/* 内容区域 */}
        {loading ? (
          renderLoadingState()
        ) : sortedStories.length === 0 ? (
          renderEmptyState()
        ) : (
          <div>{viewMode === 'grid' ? renderGridView() : renderListView()}</div>
        )}
      </div>
    )
  }
)

OptimizedStoryList.displayName = 'OptimizedStoryList'

export default OptimizedStoryList
