import type { SystemTemplateSeed } from './index'

export const rfcTemplate: SystemTemplateSeed = {
  key: 'rfc',
  emoji: '📐',
  sortOrder: 2,
  content: [
    '<h1>RFC：标题</h1>',
    '<h2>摘要</h2><p>一段话说明本提案要解决什么。</p>',
    '<h2>动机</h2><p>为什么现在需要这个改动。</p>',
    '<h2>详细设计</h2><p>接口、数据模型、流程与关键决策。</p>',
    '<h2>备选方案</h2><ul><li>方案 A —— 取舍</li><li>方案 B —— 取舍</li></ul>',
    '<h2>影响面</h2><p>对现有系统、迁移、兼容性的影响。</p>',
    '<h2>未决问题</h2><ul><li>待讨论的开放问题</li></ul>',
  ].join(''),
}
