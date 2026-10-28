import { ipcMain } from 'electron'
import type { RepoHealth } from '../../shared/repo-health-types'
import { checkSite, getRepoHealth } from '../repo-health/repo-health'
import { setSiteWatching, startLiveSiteWatcher } from '../repo-health/live-site-watch'

export function registerRepoHealthHandlers(): void {
  ipcMain.removeHandler('repoHealth:get')
  ipcMain.removeHandler('repoHealth:setWatch')
  ipcMain.handle(
    'repoHealth:get',
    (_event, args: { path?: unknown; force?: unknown }): Promise<RepoHealth> | null =>
      typeof args?.path === 'string' && args.path
        ? getRepoHealth(args.path, args.force === true)
        : null
  )
  ipcMain.handle('repoHealth:setWatch', (_event, args: { url?: unknown; on?: unknown }) =>
    typeof args?.url === 'string' ? setSiteWatching(args.url, args.on === true) : false
  )
  startLiveSiteWatcher(checkSite)
}
