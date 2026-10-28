import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RepoHealthService } from '../../shared/repo-health-types'
import { parseJson, readText } from './repo-command'

function envNames(path: string): Set<string> | null {
  const text = readText(path)
  if (text === null) {
    return null
  }
  const names = new Set<string>()
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/i.exec(line)
    if (match) {
      names.add(match[1])
    }
  }
  return names
}

export function missingEnv(top: string): string[] | null {
  const example =
    envNames(join(top, '.env.example')) ??
    envNames(join(top, '.env.sample')) ??
    envNames(join(top, '.env.template'))
  if (!example) {
    return null
  }
  const have = new Set([
    ...(envNames(join(top, '.env')) ?? []),
    ...(envNames(join(top, '.env.local')) ?? [])
  ])
  return [...example].filter((name) => !have.has(name))
}

// Where the repo deploys, from config files checked into it.

export function deployServices(top: string): RepoHealthService[] {
  const at = (...parts: string[]): string => join(top, ...parts)
  const has = (...parts: string[]): boolean => existsSync(at(...parts))
  const services: RepoHealthService[] = []
  const tomlValue = (file: string, key: string): string | null =>
    new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)`, 'm').exec(readText(at(file)) ?? '')?.[1] ?? null
  if (has('firebase.json') || has('.firebaserc')) {
    const project =
      parseJson<{ projects?: { default?: string } }>(readText(at('.firebaserc')) ?? '')?.projects
        ?.default ?? null
    const config = parseJson<Record<string, unknown>>(readText(at('firebase.json')) ?? '') ?? {}
    const parts = ['firestore', 'storage', 'database', 'hosting', 'functions'].filter(
      (k) => k in config
    )
    services.push({
      name: 'Firebase',
      project,
      detail: parts.length ? parts.join(', ') : null,
      files: ['firebase.json', '.firebaserc'].filter((f) => has(f))
    })
  }
  if (has('vercel.json') || has('.vercel', 'project.json')) {
    const linked = parseJson<{ projectName?: string; projectId?: string }>(
      readText(at('.vercel', 'project.json')) ?? ''
    )
    services.push({
      name: 'Vercel',
      project: linked?.projectName ?? linked?.projectId ?? null,
      detail: has('.vercel', 'project.json') ? 'linked' : 'not linked',
      files: ['vercel.json', '.vercel/project.json'].filter((f) => has(...f.split('/')))
    })
  }
  if (has('supabase', 'config.toml')) {
    const count = (dir: string): number => {
      try {
        return readdirSync(at('supabase', dir)).filter((x) => !x.startsWith('.')).length
      } catch {
        return 0
      }
    }
    services.push({
      name: 'Supabase',
      project: tomlValue('supabase/config.toml', 'project_id'),
      detail: `${count('functions')} edge functions · ${count('migrations')} migrations`,
      files: ['supabase/config.toml']
    })
  }
  const simple: [string, string, string | null][] = [
    ['netlify.toml', 'Netlify', null],
    ['wrangler.toml', 'Cloudflare', 'name'],
    ['fly.toml', 'Fly.io', 'app'],
    ['render.yaml', 'Render', null],
    ['railway.json', 'Railway', null],
    ['railway.toml', 'Railway', null],
    ['Procfile', 'Heroku', null],
    ['Dockerfile', 'Docker', null],
    ['eas.json', 'Expo / EAS', null]
  ]
  for (const [file, name, key] of simple) {
    if (has(file) && !services.some((s) => s.name === name)) {
      services.push({
        name,
        project: key ? tomlValue(file, key) : null,
        detail: null,
        files: [file]
      })
    }
  }
  let workflows: string[] = []
  try {
    workflows = readdirSync(at('.github', 'workflows')).filter((f) => /\.ya?ml$/i.test(f))
  } catch {
    // No workflows.
  }
  const deployFlows = workflows.filter(
    (f) =>
      /deploy|release|publish|pages/i.test(f) ||
      /deploy|firebase|vercel|netlify|pages|wrangler|flyctl|eas (build|submit)/i.test(
        readText(at('.github', 'workflows', f)) ?? ''
      )
  )
  if (deployFlows.length) {
    services.push({
      name: 'GitHub Actions deploy',
      project: null,
      detail: null,
      files: deployFlows.map((f) => `.github/workflows/${f}`)
    })
  }
  return services
}
