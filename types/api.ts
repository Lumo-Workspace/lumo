/**
 * API相关的类型定义
 */

import type { ID } from './index'

// ==================== API基础类型 ====================

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  url: string
  params?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
  timestamp: string
}

export interface ApiRequest<T = unknown> {
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  data?: T
  params?: Record<string, unknown>
  headers?: Record<string, string>
}

// ==================== 分页相关 ====================

export interface PaginationParams {
  page: number
  limit: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

// ==================== 搜索和过滤 ====================

export interface SearchParams {
  query?: string
  filters?: Record<string, unknown>
  pagination?: PaginationParams
}

export interface FilterOption {
  key: string
  label: string
  type: 'text' | 'select' | 'multiselect' | 'date' | 'number' | 'boolean'
  options?: Array<{ value: string | number; label: string }>
}

// ==================== 缓存相关 ====================

export interface CacheConfig {
  ttl: number // Time to live in seconds
  key: string
  tags?: string[]
}

export interface CacheEntry<T = unknown> {
  data: T
  timestamp: number
  ttl: number
  tags: string[]
}

// ==================== 上传相关 ====================

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export interface UploadResult {
  success: boolean
  fileId?: ID
  url?: string
  error?: string
}
