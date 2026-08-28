export const en = {
  actions: 'actions',
  working: 'working…',
  retried: 'retried',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  mixed: 'mixed',
  succeeded: 'succeeded',
  failedCount: '{n} failed',
} as const

export const zh = {
  actions: '步操作',
  working: '进行中…',
  retried: '已重试',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  mixed: '部分失败',
  succeeded: '成功',
  failedCount: '{n} 项失败',
} as const

export type ChatKey = keyof typeof en
