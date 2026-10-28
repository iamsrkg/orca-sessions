import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { ipcMain } from 'electron'

export type HistoryProjectFolder = { path: string; kind: 'git' | 'folder'; cwds: string[] }

const MAX_FOLDERS = 200

function gitTop(cwd: string): Promise<string | null> {
  return new Promise((done) =>
    execFile(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd, timeout: 4_000, windowsHide: true },
      (err, out) => done(err ? null : String(out).trim() || null)
    )
  )
}

const key = (path: string): string => {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Project roots for the folders past chats ran in: the git top folder, else the folder itself. */
export async function historyProjectFolders(
  cwds: readonly string[]
): Promise<HistoryProjectFolder[]> {
  const home = key(homedir())
  const skipped = [key(tmpdir()), key(`${homedir()}${sep}AppData`)]
  const byRoot = new Map<string, HistoryProjectFolder>()
  for (const cwd of [...new Set(cwds)].slice(0, MAX_FOLDERS)) {
    const cwdKey = key(cwd)
    // The home folder and temp/app-data folders are not projects; their chats stay under "Other folders".
    if (
      cwdKey === home ||
      skipped.some((s) => cwdKey === s || cwdKey.startsWith(s + sep)) ||
      !existsSync(cwd)
    ) {
      continue
    }
    const top = await gitTop(cwd)
    const root = top ? resolve(top) : resolve(cwd)
    const rootKey = key(root)
    if (rootKey === home) {
      continue
    }
    const entry = byRoot.get(rootKey) ?? { path: root, kind: top ? 'git' : 'folder', cwds: [] }
    entry.cwds.push(cwd)
    byRoot.set(rootKey, entry)
  }
  return [...byRoot.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function registerHistoryProjectFolderHandlers(): void {
  ipcMain.removeHandler('historyProjects:folders')
  ipcMain.handle('historyProjects:folders', (_event, cwds: unknown) =>
    historyProjectFolders(
      Array.isArray(cwds) ? cwds.filter((c): c is string => typeof c === 'string') : []
    )
  )
}
