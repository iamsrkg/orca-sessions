import { app } from 'electron'
import { applyWindowsTaskbarBadge } from './windows-taskbar-badge'

let unreadCount = 0

function applyDockBadge(): void {
  if (process.platform === 'win32') {
    applyWindowsTaskbarBadge(unreadCount)
    return
  }
  if (process.platform !== 'darwin') {
    return
  }

  const label = unreadCount === 0 ? '' : unreadCount > 99 ? '99+' : String(unreadCount)
  app.dock?.setBadge(label)
}

export function setUnreadDockBadgeCount(count: number): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return
  }

  unreadCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0

  applyDockBadge()
}
