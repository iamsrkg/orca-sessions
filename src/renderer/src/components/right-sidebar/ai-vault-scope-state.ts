import type { AiVaultScope } from '../../../../shared/ai-vault-types'

// Orca Sessions: open on every chat; Workspace and Project stay one click away.
export const DEFAULT_AI_VAULT_SCOPE: AiVaultScope = 'all'

export function normalizeAiVaultScopeForContext(args: {
  scope: AiVaultScope
  activeProjectKey: string | null
  activeWorktreePath: string | null
}): AiVaultScope {
  if (args.scope === 'project' && !args.activeProjectKey) {
    return 'all'
  }
  if (args.scope === 'workspace' && !args.activeWorktreePath) {
    return 'all'
  }
  return args.scope
}
