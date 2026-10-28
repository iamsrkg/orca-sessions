import { ipcRenderer } from 'electron'
import type { RepoHealth } from '../../shared/repo-health-types'
import type { PreloadApi } from '../api-types'

export const repoHealthApi = {
  get: (path: string, force = false): Promise<RepoHealth | null> =>
    ipcRenderer.invoke('repoHealth:get', { path, force }),
  setWatch: (url: string, on: boolean): Promise<boolean> =>
    ipcRenderer.invoke('repoHealth:setWatch', { url, on }),
  historyProjectFolders: (
    cwds: string[]
  ): Promise<{ path: string; kind: 'git' | 'folder'; cwds: string[] }[]> =>
    ipcRenderer.invoke('historyProjects:folders', cwds)
} satisfies PreloadApi['repoHealth']
