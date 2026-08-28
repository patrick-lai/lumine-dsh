export type RoutinesKey =
  | 'nav'
  | 'empty'
  | 'create'
  | 'creating'
  | 'cancel'
  | 'save'
  | 'title'
  | 'prompt'
  | 'when'
  | 'once'
  | 'interval'
  | 'cron'
  | 'manual'
  | 'at'
  | 'seconds'
  | 'expression'
  | 'timezone'
  | 'quietHours'
  | 'quietStart'
  | 'quietEnd'
  | 'weekdays'
  | 'maxRuns'
  | 'nextIfEnabled'
  | 'enable'
  | 'pause'
  | 'runNow'
  | 'delete'
  | 'paused'
  | 'on'
  | 'next'
  | 'error'
  | 'pausedHint'
  | 'editPauses'
  | 'runNowPaused'
  | 'retry'
  | 'loading'
  | 'close'
  | 'openPane'
  | 'settingsHint'
  | 'cadence'

export const en: Record<RoutinesKey, string> = {
  nav: 'Routines',
  empty: 'No routines yet.',
  create: 'Create',
  creating: 'Saving',
  cancel: 'Cancel',
  save: 'Save',
  title: 'Title',
  prompt: 'Prompt',
  when: 'When',
  once: 'once',
  interval: 'interval',
  cron: 'cron',
  manual: 'manual',
  at: 'At',
  seconds: 'Seconds',
  expression: 'Cron',
  timezone: 'Timezone',
  quietHours: 'Quiet hours',
  quietStart: 'Quiet start',
  quietEnd: 'Quiet end',
  weekdays: 'Weekdays',
  maxRuns: 'Max runs',
  nextIfEnabled: 'Next if enabled',
  enable: 'Enable',
  pause: 'Pause',
  runNow: 'Run now',
  delete: 'Delete',
  paused: 'paused',
  on: 'on',
  next: 'next',
  error: 'last error',
  pausedHint: 'New routines start paused.',
  editPauses: 'Saving an edit pauses the routine.',
  runNowPaused: 'Run now is only available while a routine is on.',
  retry: 'Retry',
  loading: 'Loading',
  close: 'Close',
  openPane: 'Open Routines',
  settingsHint: 'Routines live on the left rail.',
  cadence: 'Cadence',
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
  when: '何时',
  once: '一次',
  interval: '间隔',
  cron: 'cron',
  manual: '手动',
  at: '时间',
  seconds: '秒',
  expression: 'Cron',
  timezone: '时区',
  quietHours: '静默时段',
  quietStart: '开始',
  quietEnd: '结束',
  weekdays: '星期',
  maxRuns: '最多次数',
  nextIfEnabled: '启用后下次',
  enable: '启用',
  pause: '暂停',
  runNow: '立即运行',
  delete: '删除',
  paused: '已暂停',
  on: '已启用',
  next: '下次',
  error: '上次错误',
  pausedHint: '新建的例程默认暂停。',
  editPauses: '保存编辑会暂停该例程。',
  runNowPaused: '暂停中的例程不能立即运行。',
  retry: '重试',
  loading: '加载中',
  close: '关闭',
  openPane: '打开 Routines',
  settingsHint: '例程在左侧栏。',
  cadence: '节奏',
}
