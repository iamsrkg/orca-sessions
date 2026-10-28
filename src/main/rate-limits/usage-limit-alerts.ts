import { app, BrowserWindow, Notification } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RateLimitState, RateLimitWindow } from '../../shared/rate-limit-types'
import type { RateLimitService } from './service'

const THRESHOLDS = [95, 80] as const
const MAX_REMEMBERED = 200
let uninstallPrevious: (() => void) | null = null

function alertFile(): string {
  return join(app.getPath('userData'), 'usage-limit-alerts.json')
}

function loadAlerted(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(alertFile(), 'utf8'))
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

function resetText(window: RateLimitWindow): string {
  if (window.resetsAt) {
    const at = new Date(window.resetsAt)
    const sameDay = at.toDateString() === new Date().toDateString()
    const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return `Resets ${sameDay ? time : `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`}.`
  }
  return window.resetDescription ? `Resets ${window.resetDescription}.` : ''
}

/** Windows/macOS notification (with the system sound) when a Claude limit passes 80% and 95%, once per window. */
export function installUsageLimitAlerts(rateLimits: RateLimitService): () => void {
  // Handlers can be registered again for a new window; keep one listener so an alert never shows twice.
  uninstallPrevious?.()
  const alerted = loadAlerted()
  const remember = (key: string): void => {
    alerted.add(key)
    const keys = [...alerted].slice(-MAX_REMEMBERED)
    try {
      writeFileSync(alertFile(), JSON.stringify(keys))
    } catch {
      // Without the file an alert may repeat once after a restart.
    }
  }
  const check = (state: RateLimitState): void => {
    const claude = state.claude
    if (!claude || !Notification.isSupported()) {
      return
    }
    const windows: [string, RateLimitWindow | null | undefined][] = [
      ['5-hour', claude.session],
      ['Weekly', claude.weekly],
      ['Fable weekly', claude.fableWeekly]
    ]
    for (const [label, window] of windows) {
      if (!window || (window.resetsAt !== null && window.resetsAt <= Date.now())) {
        continue
      }
      const level = THRESHOLDS.find((t) => window.usedPercent >= t)
      if (!level) {
        continue
      }
      const key = `${label}:${level}:${window.resetsAt ?? 'unknown'}`
      if (alerted.has(key)) {
        continue
      }
      // A first sighting at 95% also covers the 80% alert of the same window.
      for (const t of THRESHOLDS) {
        if (t <= level) {
          remember(`${label}:${t}:${window.resetsAt ?? 'unknown'}`)
        }
      }
      const notification = new Notification({
        title: `Claude ${label.toLowerCase()} limit at ${Math.round(window.usedPercent)}%`,
        body: `${resetText(window)} Switch routine turns to a cheaper model or pause.`.trim()
      })
      notification.on('click', () => {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (win) {
          if (win.isMinimized()) {
            win.restore()
          }
          win.focus()
        }
      })
      notification.show()
    }
  }
  check(rateLimits.getState())
  const unsubscribe = rateLimits.onStateChange(check)
  uninstallPrevious = unsubscribe
  return unsubscribe
}
