import { app, Notification, shell } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RepoHealthSite, RepoHealthSiteCheck } from '../../shared/repo-health-types'

type WatchedSite = {
  on: boolean
  host: string
  repo: string | null
  state: 'up' | 'asleep' | 'down'
  fails: number
  /** What the user was last told, so down/back alerts fire once per change. */
  alerted: 'up' | 'down'
  checkedAt: number
}

const CHECK_EVERY_MS = 10 * 60_000
let timer: ReturnType<typeof setInterval> | null = null

function watchFile(): string {
  return join(app.getPath('userData'), 'live-site-watch.json')
}

function readWatch(): Record<string, WatchedSite> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(watchFile(), 'utf8'))
    // SAFETY: this file is written only by writeWatch below.
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, WatchedSite>) : {}
  } catch {
    return {}
  }
}

function writeWatch(watch: Record<string, WatchedSite>): void {
  try {
    writeFileSync(`${watchFile()}.tmp`, JSON.stringify(watch, null, 2))
    renameSync(`${watchFile()}.tmp`, watchFile())
  } catch {
    // Retried with the next check.
  }
}

const stateOf = (check: RepoHealthSiteCheck): WatchedSite['state'] =>
  check.ok ? 'up' : check.asleep ? 'asleep' : 'down'

export function isWatching(url: string): boolean {
  return readWatch()[url]?.on ?? true
}

/** Every live site the Health tab finds is watched unless the user turned it off. */
export function rememberSites(sites: RepoHealthSite[], repo: string | null): void {
  const watch = readWatch()
  for (const site of sites) {
    const previous = watch[site.url]
    watch[site.url] = {
      on: previous?.on ?? true,
      host: site.host,
      repo,
      state: stateOf(site.check),
      fails: previous?.fails ?? 0,
      alerted: previous?.alerted ?? 'up',
      checkedAt: Date.now()
    }
  }
  writeWatch(watch)
}

export function setSiteWatching(url: string, on: boolean): boolean {
  const watch = readWatch()
  if (!watch[url]) {
    return false
  }
  watch[url] = { ...watch[url], on, fails: 0 }
  writeWatch(watch)
  return true
}

function notify(title: string, body: string, url: string): void {
  if (!Notification.isSupported()) {
    return
  }
  const notification = new Notification({ title, body })
  notification.on('click', () => void shell.openExternal(url))
  notification.show()
}

// Down = two failed checks in a row; a sleeping free tier or a login wall never counts as down.
async function checkWatchedSites(
  check: (url: string) => Promise<RepoHealthSiteCheck>
): Promise<void> {
  const watch = readWatch()
  for (const [url, site] of Object.entries(watch)) {
    if (!site.on) {
      continue
    }
    const state = stateOf(await check(url))
    site.fails = state === 'down' ? site.fails + 1 : 0
    if (site.fails >= 2 && site.alerted !== 'down') {
      site.alerted = 'down'
      notify(
        `Live site down: ${site.host}`,
        `${url}${site.repo ? ` (${site.repo})` : ''} is not answering.`,
        url
      )
    } else if (state !== 'down' && site.alerted === 'down') {
      site.alerted = 'up'
      notify(
        `Live site back: ${site.host}`,
        `${url} is ${state === 'asleep' ? 'asleep (wakes on the first visit)' : 'up again'}.`,
        url
      )
    }
    site.state = state
    site.checkedAt = Date.now()
  }
  // Merge into the newest file: the Health tab may have added sites during the checks.
  const latest = readWatch()
  for (const [url, site] of Object.entries(watch)) {
    if (latest[url]) {
      latest[url] = { ...site, on: latest[url].on }
    }
  }
  writeWatch(latest)
}

export function startLiveSiteWatcher(check: (url: string) => Promise<RepoHealthSiteCheck>): void {
  if (timer) {
    return
  }
  timer = setInterval(() => void checkWatchedSites(check), CHECK_EVERY_MS)
}
