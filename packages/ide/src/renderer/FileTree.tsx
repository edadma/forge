import { useState, useEffect, useCallback } from 'react'

const forge = (window as any).forge

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface FileTreeNodeProps {
  entry: DirEntry
  depth: number
  onFileClick: (filePath: string) => void
}

function FileTreeNode({ entry, depth, onFileClick }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)

  const toggle = useCallback(async () => {
    if (!entry.isDirectory) {
      onFileClick(entry.path)
      return
    }
    if (!expanded && children === null) {
      const entries = await forge.readDirectory(entry.path)
      setChildren(entries)
    }
    setExpanded((prev) => !prev)
  }, [entry, expanded, children, onFileClick])

  return (
    <>
      <div
        className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-base-200 truncate select-none"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={toggle}
      >
        {entry.isDirectory ? (
          <span className="text-xs w-4 text-center shrink-0">{expanded ? '▼' : '▶'}</span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="truncate text-sm">{entry.name}</span>
      </div>
      {expanded && children?.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          onFileClick={onFileClick}
        />
      ))}
    </>
  )
}

interface FileTreeProps {
  projectPath: string
  onFileClick: (filePath: string) => void
}

export default function FileTree({ projectPath, onFileClick }: FileTreeProps) {
  const [entries, setEntries] = useState<DirEntry[]>([])

  useEffect(() => {
    forge.readDirectory(projectPath).then(setEntries)
  }, [projectPath])

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-base-200 text-base-content">
      <div className="px-3 py-2 text-xs font-semibold uppercase text-base-content/50 truncate">
        {projectPath.split('/').pop()}
      </div>
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  )
}
