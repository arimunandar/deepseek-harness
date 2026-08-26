/**
 * Copy for the connections page.
 *
 * The vocabulary is deliberately smaller than the seam's: a person reads
 * "Connected", "Not connected", "Finish setup", and "Needs attention", and
 * never reads credential, reference, record, route, provider, or namespace. A
 * key that would require explaining one of those does not belong here — it
 * belongs on the Models page, which is the surface for someone who wants them.
 */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '连接',
  heading: '连接你的 AI',
  intro: '选一个来用。可以随时连接多个，并在它们之间切换。',
  loading: '正在读取…',
  error: '暂时无法读取连接状态。',
  retry: '重试',
  statusConnected: '已连接',
  statusNotConnected: '未连接',
  statusSetupRequired: '需要完成设置',
  statusNeedsAttention: '需要处理',
  whyRouteMissing: '已经登录，还差最后一步就能使用。',
  whyCredentialMissing: '登录信息已失效，请重新登录。',
  whyKeyMissing: '这个后端需要一个 API 密钥，在“模型”页填写。',
  whyCredentialReadOnly: '登录信息由启动这个程序的环境提供，只能在那里修改。',
  connect: '连接',
  connecting: '正在连接…',
  cancel: '取消',
  reconnect: '重新登录',
  finishSetup: '完成设置',
  disconnect: '断开连接',
  useForNewChats: '用于新对话',
  inUse: '正在使用',
  unavailable: '这个后端在当前配置下无法连接。',
  alreadyInstalled: '检测到你已经安装了它的官方命令行工具，用同一个账号登录即可。',
  keepTabOpen: '登录过程中请保持这个页面打开；刷新会中断登录。',
  openPage: '打开登录页面',
  copyCode: '复制代码',
  continueLabel: '继续',
  disconnectTitle: '断开 {{name}}？',
  disconnectBody: '这只会让本机忘记登录信息，不会注销你在 {{name}} 的账号。随时可以重新连接。',
  disconnectConfirm: '确认断开',
  disconnectCancel: '返回',
  close: '关闭',
} as const

/** Key set every dictionary must carry. */
export type ConnectionsLocaleKey = keyof typeof zh

/** English dictionary. */
export const en: Record<ConnectionsLocaleKey, string> = {
  nav: 'Connections',
  heading: 'Connect your AI',
  intro: 'Pick one to get started. You can connect more than one and switch between them at any time.',
  loading: 'Loading…',
  error: 'Cannot read connection status right now.',
  retry: 'Try again',
  statusConnected: 'Connected',
  statusNotConnected: 'Not connected',
  statusSetupRequired: 'Setup required',
  statusNeedsAttention: 'Needs attention',
  whyRouteMissing: 'You are signed in — one step left before you can use it.',
  whyCredentialMissing: 'The sign-in is no longer valid. Sign in again.',
  whyKeyMissing: 'This one needs an API key, which is entered on the Models page.',
  whyCredentialReadOnly: 'This sign-in comes from the environment this app was started in, and can only be changed there.',
  connect: 'Connect',
  connecting: 'Connecting…',
  cancel: 'Cancel',
  reconnect: 'Sign in again',
  finishSetup: 'Finish setup',
  disconnect: 'Disconnect',
  useForNewChats: 'Use for new chats',
  inUse: 'In use',
  unavailable: 'This one cannot be connected in the current setup.',
  alreadyInstalled: 'You already have its official command-line tool installed — sign in with the same account.',
  keepTabOpen: 'Keep this page open while you sign in; reloading starts over.',
  openPage: 'Open the sign-in page',
  copyCode: 'Copy code',
  continueLabel: 'Continue',
  disconnectTitle: 'Disconnect {{name}}?',
  disconnectBody: 'This only makes this computer forget the sign-in. It does not sign you out of {{name}}, and you can reconnect at any time.',
  disconnectConfirm: 'Yes, disconnect',
  disconnectCancel: 'Go back',
  close: 'Close',
}
