import type { SystemTemplateSeed } from './index'

export const meetingNotesTemplate: SystemTemplateSeed = {
  key: 'meeting-notes',
  emoji: '📝',
  sortOrder: 3,
  content: [
    '<h1>会议纪要：主题</h1>',
    '<p><strong>时间：</strong>　<strong>地点：</strong>　<strong>参会人：</strong></p>',
    '<h2>议程</h2><ol><li>议题一</li><li>议题二</li></ol>',
    '<h2>讨论记录</h2><p>关键讨论与结论。</p>',
    '<h2>Action Items</h2>',
    '<ul data-type="taskList">',
    '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>负责人 —— 待办事项</p></div></li>',
    '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>负责人 —— 待办事项</p></div></li>',
    '</ul>',
    '<h2>下次会议</h2><p>时间与议题。</p>',
  ].join(''),
}
