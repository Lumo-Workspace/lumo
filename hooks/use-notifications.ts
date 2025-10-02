"use client"

import { useState } from "react"

export interface Notification {
  id: number
  title: string
  content: string
  time: string
  unread: boolean
  sender: string
  fullContent: string
  type: "comment" | "task" | "update" | "mention"
  documentId?: string
}

const initialNotifications: Notification[] = [
  {
    id: 1,
    title: "项目计划文档已更新",
    content: "张三更新了项目计划文档，添加了新的里程碑和时间线。请查看最新的项目进度安排。",
    time: "2小时前",
    unread: true,
    sender: "张三",
    fullContent:
      "项目计划文档已更新\n\n张三在项目计划文档中添加了以下内容：\n\n• 新增Q1季度里程碑\n• 更新了技术栈选择\n• 调整了团队分工安排\n• 添加了风险评估部分\n\n请所有团队成员查看并确认相关安排。如有疑问，请在文档中留言或直接联系我。\n\n变更详情：\n- 前端开发时间延长至3周\n- 后端API开发提前至第2周开始\n- 测试阶段增加性能测试环节",
    type: "update",
    documentId: "2",
  },
  {
    id: 2,
    title: "会议记录中提到了你",
    content: "@李四 请确认下周的技术评审时间，并准备相关的技术文档。",
    time: "4小时前",
    unread: true,
    sender: "王五",
    fullContent:
      "会议记录 - 技术评审准备\n\n@李四 请确认下周的技术评审时间，并准备相关的技术文档。\n\n会议要点：\n1. 技术架构设计已基本完成\n2. 需要进行技术评审确保方案可行性\n3. 评审后开始详细开发计划制定\n\n请准备的材料：\n- 系统架构图\n- 技术选型说明\n- 性能预估报告\n- 安全方案设计\n\n建议时间：下周三下午2点\n地点：会议室A或线上会议",
    type: "mention",
    documentId: "3",
  },
  {
    id: 3,
    title: "新任务分配",
    content: "你被分配了一个新任务：完成用户认证模块的设计文档。截止时间：本周五。",
    time: "1天前",
    unread: false,
    sender: "项目管理系统",
    fullContent:
      "任务分配通知\n\n任务名称：用户认证模块设计文档\n分配给：李四\n优先级：高\n截止时间：本周五 18:00\n\n任务描述：\n设计并编写用户认证模块的详细文档，包括：\n\n1. 认证流程设计\n   - 登录/注册流程\n   - 密码重置流程\n   - 多因素认证\n\n2. 安全考虑\n   - 密码加密策略\n   - Session管理\n   - API安全\n\n3. 技术实现\n   - 数据库设计\n   - API接口定义\n   - 前端集成方案\n\n请在完成后通知相关团队成员进行评审。",
    type: "task",
  },
  {
    id: 4,
    title: "文档评论",
    content: "赵六在技术规范文档中添加了评论：建议增加错误处理的详细说明。",
    time: "2天前",
    unread: false,
    sender: "赵六",
    fullContent:
      '技术规范文档评论\n\n赵六在技术规范文档中添加了评论：\n\n"建议增加错误处理的详细说明"\n\n具体建议：\n\n1. 错误分类\n   - 系统错误\n   - 业务逻辑错误\n   - 用户输入错误\n   - 网络错误\n\n2. 错误处理策略\n   - 错误日志记录\n   - 用户友好的错误提示\n   - 错误恢复机制\n   - 降级处理方案\n\n3. 监控和告警\n   - 错误率监控\n   - 关键错误告警\n   - 性能影响分析\n\n请考虑将这些内容补充到技术规范中，以确保系统的健壮性。',
    type: "comment",
    documentId: "4",
  },
  {
    id: 5,
    title: "周报提醒",
    content: "请记得提交本周的工作周报，截止时间是今天下午6点。",
    time: "3天前",
    unread: false,
    sender: "系统提醒",
    fullContent:
      "周报提交提醒\n\n亲爱的团队成员，\n\n请记得提交本周的工作周报，截止时间是今天下午6点。\n\n周报应包含以下内容：\n\n1. 本周完成的工作\n   - 具体任务和成果\n   - 遇到的问题和解决方案\n   - 学习和成长收获\n\n2. 下周工作计划\n   - 计划完成的任务\n   - 预期的挑战和风险\n   - 需要的支持和资源\n\n3. 其他事项\n   - 团队协作反馈\n   - 流程改进建议\n   - 个人发展需求\n\n请通过项目管理系统提交周报，如有问题请联系项目经理。",
    type: "update",
  },
]

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null)

  const markNotificationAsRead = (notificationId: number) => {
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === notificationId ? { ...notification, unread: false } : notification,
      ),
    )
  }

  return {
    notifications,
    selectedNotification,
    setSelectedNotification,
    markNotificationAsRead,
  }
}
