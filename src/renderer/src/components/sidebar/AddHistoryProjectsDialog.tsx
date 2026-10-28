import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type Folder = { path: string; kind: 'git' | 'folder'; cwds: string[] }

/** Lists the folders past chats ran in (git roots) and adds the ticked ones as Orca projects. */
export function AddHistoryProjectsDialog({
  open,
  onOpenChange,
  cwds,
  knownPaths,
  onAdded
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cwds: string[]
  knownPaths: Set<string>
  onAdded: () => void
}): React.JSX.Element {
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setFolders(null)
    void window.api.repoHealth.historyProjectFolders(cwds).then((list) => {
      const fresh = list.filter((f) => !knownPaths.has(f.path.replace(/\\/g, '/').toLowerCase()))
      setFolders(fresh)
      setPicked(new Set(fresh.map((f) => f.path)))
    })
  }, [open, cwds, knownPaths])

  const add = async (): Promise<void> => {
    setAdding(true)
    let added = 0
    const failed: string[] = []
    for (const folder of folders ?? []) {
      if (!picked.has(folder.path)) {
        continue
      }
      const result = await window.api.repos.add({
        path: folder.path.replace(/\\/g, '/'),
        kind: folder.kind
      })
      if ('error' in result) {
        failed.push(`${folder.path}: ${result.error}`)
      } else {
        added++
      }
    }
    setAdding(false)
    if (added) {
      toast.success(`Added ${added} project${added === 1 ? '' : 's'} from your chat history`)
    }
    if (failed.length) {
      toast.error('Some folders could not be added', { description: failed.join('\n') })
    }
    onAdded()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add projects from your chat history</DialogTitle>
          <DialogDescription>
            Folders your past chats worked in. Each ticked folder becomes an Orca project, so its
            chats show under it. Your files are not changed.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border scrollbar-sleek">
          {!folders ? (
            <p className="p-3 text-xs text-muted-foreground">Finding project folders…</p>
          ) : folders.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Every folder from your chats is already a project.
            </p>
          ) : (
            folders.map((folder) => (
              <label
                key={folder.path}
                className="flex cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-accent"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={picked.has(folder.path)}
                  onCheckedChange={(on) => {
                    const next = new Set(picked)
                    if (on === true) {
                      next.add(folder.path)
                    } else {
                      next.delete(folder.path)
                    }
                    setPicked(next)
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{folder.path}</span>
                  <span className="text-2xs text-muted-foreground">
                    {folder.kind === 'git' ? 'Git repository' : 'Folder'} · {folder.cwds.length}{' '}
                    chat folder{folder.cwds.length === 1 ? '' : 's'}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void add()} disabled={adding || !folders || picked.size === 0}>
            {adding ? 'Adding…' : `Add ${picked.size} project${picked.size === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
