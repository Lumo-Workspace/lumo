/**
 * 表单相关类型定义
 * Form related type definitions
 */

import { 
  Priority,
  TaskStatus,
  Page,
  UserRole,
  ProjectStatus,
  PRDStatus,
  EpicStatus
} from './index'

// 基础表单字段类型
export interface BaseFormField {
  name: string
  label: string
  required: boolean
  disabled?: boolean
  placeholder?: string
  helpText?: string
}

export interface TextField extends BaseFormField {
  type: 'text' | 'email' | 'password' | 'url'
  maxLength?: number
  minLength?: number
  pattern?: string
}

export interface TextAreaField extends BaseFormField {
  type: 'textarea'
  maxLength?: number
  minLength?: number
  rows?: number
}

export interface SelectField extends BaseFormField {
  type: 'select'
  options: Array<{
    value: string
    label: string
    disabled?: boolean
  }>
  multiple?: boolean
}

export interface NumberField extends BaseFormField {
  type: 'number'
  min?: number
  max?: number
  step?: number
}

export interface DateField extends BaseFormField {
  type: 'date'
  min?: string
  max?: string
}

export interface CheckboxField extends BaseFormField {
  type: 'checkbox'
  checked?: boolean
}

export interface RadioField extends BaseFormField {
  type: 'radio'
  options: Array<{
    value: string
    label: string
    disabled?: boolean
  }>
}

export interface TagsField extends BaseFormField {
  type: 'tags'
  suggestions?: string[]
  maxTags?: number
}

export interface FileField extends BaseFormField {
  type: 'file'
  accept?: string
  multiple?: boolean
  maxSize?: number
}

export type FormField = 
  | TextField 
  | TextAreaField 
  | SelectField 
  | NumberField 
  | DateField 
  | CheckboxField 
  | RadioField 
  | TagsField 
  | FileField

// 表单配置类型
export interface FormConfig<T = any> {
  fields: FormField[]
  validation?: ValidationConfig<T>
  layout?: FormLayout
  submitButton?: SubmitButtonConfig
  resetButton?: ResetButtonConfig
}

export interface ValidationConfig<T = any> {
  schema?: any // Zod schema
  rules?: ValidationRule<T>[]
  mode?: 'onChange' | 'onBlur' | 'onSubmit'
}

export interface ValidationRule<T = any> {
  field: keyof T
  rule: (value: any, formData: T) => boolean | string
  message?: string
}

export interface FormLayout {
  columns?: number
  spacing?: 'compact' | 'normal' | 'loose'
  alignment?: 'left' | 'center' | 'right'
}

export interface SubmitButtonConfig {
  text?: string
  loading?: string
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}

export interface ResetButtonConfig {
  text?: string
  show?: boolean
  variant?: 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

// 表单状态类型
export interface FormState<T = any> {
  data: T
  errors: Record<string, string>
  touched: Record<string, boolean>
  isSubmitting: boolean
  isValid: boolean
  isDirty: boolean
}

export interface FormAction<T = any> {
  type: 'SET_FIELD' | 'SET_ERROR' | 'SET_TOUCHED' | 'SET_SUBMITTING' | 'SET_VALID' | 'RESET' | 'SET_DATA'
  payload?: any
  field?: keyof T
}

// 故事创建表单类型
export interface StoryFormData {
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: string[]
  priority: Priority
  estimatedPoints: number
  assignee?: string
  tags: string[]
  dependencies: string[]
  businessValue: string
  technicalNotes?: string
}

export interface StoryFormConfig extends FormConfig<StoryFormData> {}

// 任务创建表单类型
export interface TaskFormData {
  title: string
  description?: string
  status: TaskStatus
  priority: Priority
  assignee?: string
  dueDate?: Date
  estimatedHours?: number
  tags: string[]
}

export interface TaskFormConfig extends FormConfig<TaskFormData> {}

// 页面创建表单类型
export interface PageFormData {
  title: string
  content: string
  type: Page['type']
  parentId?: string
}

export interface PageFormConfig extends FormConfig<PageFormData> {}

// 用户创建表单类型
export interface UserFormData {
  name: string
  email: string
  role: UserRole
  avatar?: File
}

export interface UserFormConfig extends FormConfig<UserFormData> {}

// 团队创建表单类型
export interface TeamFormData {
  name: string
  description?: string
  memberIds: string[]
}

export interface TeamFormConfig extends FormConfig<TeamFormData> {}

// 项目创建表单类型
export interface ProjectFormData {
  name: string
  description?: string
  teamId: string
  status: ProjectStatus
}

export interface ProjectFormConfig extends FormConfig<ProjectFormData> {}

// PRD 创建表单类型
export interface PRDFormData {
  title: string
  description?: string
  projectId: string
  status: PRDStatus
}

export interface PRDFormConfig extends FormConfig<PRDFormData> {}

// Epic 创建表单类型
export interface EpicFormData {
  title: string
  description?: string
  prdId: string
  priority: Priority
  status: EpicStatus
}

export interface EpicFormConfig extends FormConfig<EpicFormData> {}

// 质量检查表单类型
export interface QualityCheckFormData {
  storyId: string
  checks: Array<{
    id: string
    passed: boolean
    notes?: string
  }>
}

export interface QualityCheckFormConfig extends FormConfig<QualityCheckFormData> {}

// 搜索表单类型
export interface SearchFormData {
  query: string
  type?: string
  status?: string
  priority?: Priority
  assignee?: string
  tags?: string[]
  dateRange?: {
    start: Date
    end: Date
  }
}

export interface SearchFormConfig extends FormConfig<SearchFormData> {}

// 过滤器表单类型
export interface FilterFormData {
  status?: string[]
  priority?: Priority[]
  assignee?: string[]
  tags?: string[]
  dateRange?: {
    start: Date
    end: Date
  }
}

export interface FilterFormConfig extends FormConfig<FilterFormData> {}

// 设置表单类型
export interface SettingsFormData {
  theme: 'light' | 'dark' | 'system'
  language: string
  timezone: string
  notifications: {
    email: boolean
    push: boolean
    desktop: boolean
  }
  preferences: {
    autoSave: boolean
    autoSaveInterval: number
    defaultView: string
  }
}

export interface SettingsFormConfig extends FormConfig<SettingsFormData> {}

// 表单验证规则类型
export interface ValidationRuleConfig {
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  min?: number
  max?: number
  custom?: (value: any) => boolean | string
}

// 表单字段组类型
export interface FormFieldGroup {
  title?: string
  description?: string
  fields: FormField[]
  collapsible?: boolean
  collapsed?: boolean
}

// 动态表单类型
export interface DynamicFormConfig<T = any> {
  groups: FormFieldGroup[]
  validation?: ValidationConfig<T>
  layout?: FormLayout
  conditionalFields?: ConditionalFieldConfig<T>[]
}

export interface ConditionalFieldConfig<T = any> {
  field: string
  condition: (formData: T) => boolean
  show?: boolean
  required?: boolean
  disabled?: boolean
}

// 表单步骤类型（用于向导）
export interface FormStep<T = any> {
  id: string
  title: string
  description?: string
  fields: FormField[]
  validation?: ValidationConfig<T>
  optional?: boolean
}

export interface MultiStepFormConfig<T = any> {
  steps: FormStep<T>[]
  navigation?: {
    allowSkip?: boolean
    allowBack?: boolean
    showProgress?: boolean
  }
  validation?: ValidationConfig<T>
}

// 表单提交处理类型
export interface FormSubmitHandler<T = any> {
  (data: T): Promise<void> | void
}

export interface FormSubmitConfig<T = any> {
  handler: FormSubmitHandler<T>
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
  resetOnSuccess?: boolean
}

// 表单字段依赖类型
export interface FieldDependency {
  field: string
  dependsOn: string[]
  condition: (values: Record<string, any>) => boolean
  action: 'show' | 'hide' | 'enable' | 'disable' | 'require' | 'optional'
}

// 表单数据转换类型
export interface FormDataTransformer<TInput = any, TOutput = any> {
  transform: (input: TInput) => TOutput
  validate?: (output: TOutput) => boolean | string
}

// 表单字段验证结果类型
export interface FieldValidationResult {
  isValid: boolean
  error?: string
  warning?: string
}

// 表单整体验证结果类型
export interface FormValidationResult<T = any> {
  isValid: boolean
  errors: Record<string, string>
  warnings: Record<string, string>
  data: T
}