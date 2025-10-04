/**
 * 消息和文本常量
 */

// ==================== 通用消息 ====================

export const MESSAGES = {
  common: {
    loading: '加载中...',
    saving: '保存中...',
    saved: '已保存',
    error: '发生错误',
    success: '操作成功',
    confirm: '确认',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    create: '创建',
    update: '更新',
    save: '保存',
    close: '关闭',
    back: '返回',
    next: '下一步',
    previous: '上一步',
    submit: '提交',
    reset: '重置',
    search: '搜索',
    filter: '筛选',
    sort: '排序',
    refresh: '刷新',
    retry: '重试',
    copy: '复制',
    paste: '粘贴',
    undo: '撤销',
    redo: '重做',
    select: '选择',
    selectAll: '全选',
    clear: '清空',
    expand: '展开',
    collapse: '收起',
    show: '显示',
    hide: '隐藏',
  },
  validation: {
    required: '此字段为必填项',
    email: '请输入有效的邮箱地址',
    url: '请输入有效的URL',
    phone: '请输入有效的手机号码',
    username: '用户名只能包含字母、数字和下划线，长度3-20位',
    password: '密码必须包含大小写字母、数字，长度至少8位',
    minLength: (min: number) => `至少需要${min}个字符`,
    maxLength: (max: number) => `最多允许${max}个字符`,
    min: (min: number) => `最小值为${min}`,
    max: (max: number) => `最大值为${max}`,
    pattern: '格式不正确',
    unique: '该值已存在',
  },
  errors: {
    network: '网络连接失败，请检查网络设置',
    server: '服务器错误，请稍后重试',
    unauthorized: '未授权访问，请重新登录',
    forbidden: '没有权限执行此操作',
    notFound: '请求的资源不存在',
    timeout: '请求超时，请稍后重试',
    unknown: '未知错误，请联系技术支持',
    fileTooLarge: '文件大小超出限制',
    fileTypeNotAllowed: '不支持的文件类型',
    uploadFailed: '文件上传失败',
    downloadFailed: '文件下载失败',
    parseError: '数据解析错误',
    validationFailed: '数据验证失败',
  },
  success: {
    created: '创建成功',
    updated: '更新成功',
    deleted: '删除成功',
    saved: '保存成功',
    uploaded: '上传成功',
    downloaded: '下载成功',
    copied: '复制成功',
    exported: '导出成功',
    imported: '导入成功',
    published: '发布成功',
    archived: '归档成功',
    restored: '恢复成功',
  },
} as const

// ==================== 页面特定消息 ====================

export const PAGE_MESSAGES = {
  home: {
    title: '欢迎使用 Lumo',
    subtitle: 'AI驱动的文档和项目管理平台',
    description: '高效协作，智能管理，让团队工作更加流畅',
  },
  dashboard: {
    title: '仪表板',
    subtitle: '项目概览和团队动态',
    welcomeBack: '欢迎回来',
  },
  editor: {
    title: '编辑器',
    newPage: '新建页面',
    savePage: '保存页面',
    pageSaved: '页面已保存',
    autoSave: '自动保存',
    unsavedChanges: '有未保存的更改',
  },
  teams: {
    title: '团队管理',
    subtitle: '管理团队和成员',
    createTeam: '创建团队',
    joinTeam: '加入团队',
    leaveTeam: '离开团队',
    noTeams: '还没有加入任何团队',
    teamCreated: '团队创建成功',
    teamUpdated: '团队更新成功',
    teamDeleted: '团队删除成功',
  },
  projects: {
    title: '项目管理',
    subtitle: '管理项目和任务',
    createProject: '创建项目',
    noProjects: '还没有创建任何项目',
    projectCreated: '项目创建成功',
    projectUpdated: '项目更新成功',
    projectDeleted: '项目删除成功',
  },
  kanban: {
    title: '看板',
    subtitle: '任务管理和进度跟踪',
    createBoard: '创建看板',
    createColumn: '创建列',
    createCard: '创建卡片',
    moveCard: '移动卡片',
    noBoards: '还没有创建任何看板',
    boardCreated: '看板创建成功',
    columnCreated: '列创建成功',
    cardCreated: '卡片创建成功',
    cardMoved: '卡片移动成功',
  },
  inbox: {
    title: '收件箱',
    subtitle: '通知和消息',
    noNotifications: '没有新通知',
    markAsRead: '标记为已读',
    markAllAsRead: '全部标记为已读',
    notificationRead: '通知已标记为已读',
    allNotificationsRead: '所有通知已标记为已读',
  },
} as const

// ==================== 表单消息 ====================

export const FORM_MESSAGES = {
  login: {
    title: '登录',
    email: '邮箱地址',
    password: '密码',
    rememberMe: '记住我',
    forgotPassword: '忘记密码？',
    noAccount: '还没有账户？',
    signUp: '立即注册',
    loginSuccess: '登录成功',
    loginFailed: '登录失败，请检查邮箱和密码',
  },
  register: {
    title: '注册',
    name: '姓名',
    email: '邮箱地址',
    password: '密码',
    confirmPassword: '确认密码',
    agreeToTerms: '我同意用户协议和隐私政策',
    hasAccount: '已有账户？',
    signIn: '立即登录',
    registerSuccess: '注册成功',
    registerFailed: '注册失败，请重试',
    passwordsNotMatch: '两次输入的密码不一致',
  },
  profile: {
    title: '个人资料',
    avatar: '头像',
    name: '姓名',
    email: '邮箱地址',
    role: '角色',
    bio: '个人简介',
    preferences: '偏好设置',
    updateSuccess: '资料更新成功',
    updateFailed: '资料更新失败',
  },
  story: {
    title: '用户故事',
    createStory: '创建故事',
    editStory: '编辑故事',
    storyTitle: '故事标题',
    asA: '作为...',
    iWant: '我想要...',
    soThat: '以便...',
    acceptanceCriteria: '验收标准',
    priority: '优先级',
    estimatedPoints: '预估点数',
    businessValue: '业务价值',
    technicalNotes: '技术说明',
    storyCreated: '故事创建成功',
    storyUpdated: '故事更新成功',
    storyDeleted: '故事删除成功',
  },
  task: {
    title: '任务',
    createTask: '创建任务',
    editTask: '编辑任务',
    taskTitle: '任务标题',
    description: '描述',
    status: '状态',
    priority: '优先级',
    assignee: '负责人',
    dueDate: '截止日期',
    estimatedHours: '预估工时',
    tags: '标签',
    taskCreated: '任务创建成功',
    taskUpdated: '任务更新成功',
    taskDeleted: '任务删除成功',
  },
} as const

// ==================== 确认对话框消息 ====================

export const CONFIRM_MESSAGES = {
  delete: {
    title: '确认删除',
    message: '此操作不可撤销，确定要删除吗？',
    confirmText: '删除',
    cancelText: '取消',
  },
  leave: {
    title: '确认离开',
    message: '有未保存的更改，确定要离开吗？',
    confirmText: '离开',
    cancelText: '取消',
  },
  archive: {
    title: '确认归档',
    message: '确定要归档这个项目吗？',
    confirmText: '归档',
    cancelText: '取消',
  },
  publish: {
    title: '确认发布',
    message: '确定要发布这个版本吗？',
    confirmText: '发布',
    cancelText: '取消',
  },
  reset: {
    title: '确认重置',
    message: '确定要重置所有设置吗？',
    confirmText: '重置',
    cancelText: '取消',
  },
} as const

// ==================== 提示消息 ====================

export const TOOLTIP_MESSAGES = {
  sidebar: {
    toggle: '切换侧边栏',
    expand: '展开侧边栏',
    collapse: '收起侧边栏',
  },
  theme: {
    light: '切换到浅色主题',
    dark: '切换到深色主题',
    system: '跟随系统主题',
  },
  editor: {
    save: '保存文档 (Ctrl+S)',
    newPage: '新建页面 (Ctrl+N)',
    search: '搜索 (Ctrl+K)',
    undo: '撤销 (Ctrl+Z)',
    redo: '重做 (Ctrl+Shift+Z)',
  },
  kanban: {
    addCard: '添加卡片',
    moveCard: '拖拽移动卡片',
    editCard: '编辑卡片',
    deleteCard: '删除卡片',
  },
} as const

// ==================== 空状态消息 ====================

export const EMPTY_STATE_MESSAGES = {
  pages: {
    title: '还没有页面',
    description: '创建你的第一个页面开始工作',
    action: '创建页面',
  },
  teams: {
    title: '还没有团队',
    description: '创建或加入团队开始协作',
    action: '创建团队',
  },
  projects: {
    title: '还没有项目',
    description: '创建你的第一个项目',
    action: '创建项目',
  },
  tasks: {
    title: '还没有任务',
    description: '创建任务开始管理你的工作',
    action: '创建任务',
  },
  notifications: {
    title: '没有通知',
    description: '所有通知都已处理完毕',
  },
  search: {
    title: '没有找到结果',
    description: '尝试使用不同的关键词搜索',
  },
} as const

// ==================== 导出所有消息 ====================

export const ALL_MESSAGES = {
  ...MESSAGES,
  ...PAGE_MESSAGES,
  ...FORM_MESSAGES,
  ...CONFIRM_MESSAGES,
  ...TOOLTIP_MESSAGES,
  ...EMPTY_STATE_MESSAGES,
} as const
