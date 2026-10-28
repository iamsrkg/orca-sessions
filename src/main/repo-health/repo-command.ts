import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type RunResult = { ok: boolean; out: string; err: string; missing: boolean }

export function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeout = 15_000
): Promise<RunResult> {
  return new Promise((resolve) =>
    execFile(
      cmd,
      args,
      { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, out, errOut) =>
        resolve({
          ok: !err,
          out: String(out ?? ''),
          err: String(errOut ?? ''),
          missing: (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
        })
    )
  )
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
