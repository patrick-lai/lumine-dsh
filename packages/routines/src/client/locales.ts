export type RoutinesKey =
  | 'nav'
  | 'empty'
  | 'create'
  | 'creating'
  | 'cancel'
  | 'save'
  | 'title'
  | 'prompt'
  | 'cadence'
  | 'once'
  | 'interval'
  | 'cron'
  | 'manual'
  | 'at'
  | 'seconds'
  | 'expression'
  | 'enable'
  | 'pause'
  | 'runNow'
  | 'delete'
  | 'paused'
  | 'on'
  | 'next'
  | 'error'
  | 'pausedHint'
  | 'runNowPaused'
  | 'retry'
  | 'loading'

export const en: Record<RoutinesKey, string> = {
  nav: 'Routines',
  empty: 'No routines yet.',
  create: 'Create',
  creating: 'Saving',
  cancel: 'Cancel',
  save: 'Save',
  title: 'Title',
  prompt: 'Prompt',
  cadence: 'Cadence',
  once: 'once',
  interval: 'interval',
  cron: 'cron',
  manual: 'manual',
  at: 'At',
  seconds: 'Seconds',
  expression: 'Expression',
  enable: 'Enable',
  pause: 'Pause',
  runNow: 'Run now',
  delete: 'Delete',
  paused: 'paused',
  on: 'on',
  next: 'next',
  error: 'last error',
  pausedHint: 'New routines start paused.',
  runNowPaused: 'Run now is only available while a routine is on.',
  retry: 'Retry',
  loading: 'Loading',
}

export const zh: Record<RoutinesKey, string> = {
  nav: 'Routines',
  empty: '还没有例程。',
  create: '新建',
  creating: '保存中',
  cancel: '取消',
  save: '保存',
  title: '标题',
  prompt: '提示词',
  cadence: '节奏',
  once: '一次',
  interval: '间隔',
  cron: 'cron',
  manual: '手动',
  at: '时间',
  seconds: '秒',
  expression: '表达式',
  enable: '启用',
  pause: '暂停',
  runNow: '立即运行',
  delete: '删除',
  paused: '已暂停',
  on: '已启用',
  next: '下次',
  error: '上次错误',
  pausedHint: '新建的例程默认暂停。',
  runNowPaused: '暂停中的例程不能立即运行。',
  retry: '重试',
  loading: '加载中',
}
