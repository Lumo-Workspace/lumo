import type { SystemTemplateSeed } from './index'

export const weeklyReportTemplate: SystemTemplateSeed = {
  key: 'weekly-report',
  emoji: '📊',
  sortOrder: 4,
  content: [
    '<h1>周报：YYYY-WW</h1>',
    '<h2>本周完成</h2><ul><li>已完成事项</li></ul>',
    '<h2>进行中</h2><ul><li>进行中事项</li></ul>',
    '<h2>下周计划</h2><ul><li>计划事项</li></ul>',
    '<h2>阻塞</h2><ul><li>当前阻塞与需要的支持</li></ul>',
    '<h2>指标</h2><p>关键数据与进展。</p>',
  ].join(''),
}
