import { useState, useEffect } from 'react'
import { Input, Button, Flex } from 'asterui'

const forge = (window as any).forge

interface Project {
  id: number
  name: string
  path: string
  lastOpened: string
}

interface ProjectLauncherProps {
  onOpenProject: (projectPath: string) => void
}

export default function ProjectLauncher({ onOpenProject }: ProjectLauncherProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    const rows = await forge.dbGetProjects()
    // Sort by lastOpened descending
    rows.sort((a: Project, b: Project) => b.lastOpened.localeCompare(a.lastOpened))
    setProjects(rows)
  }

  async function handleOpen() {
    const folderPath = await forge.openFolderDialog()
    if (folderPath) {
      openProject(folderPath)
    }
  }

  async function openProject(projectPath: string) {
    const name = projectPath.split('/').pop() || projectPath
    await forge.dbAddProject(name, projectPath)
    onOpenProject(projectPath)
  }

  function getInitials(name: string): string {
    return name
      .split(/[-_\s]/)
      .map((w) => w[0]?.toUpperCase() || '')
      .slice(0, 2)
      .join('')
  }

  const colors = [
    'bg-error', 'bg-primary', 'bg-secondary', 'bg-accent',
    'bg-info', 'bg-success', 'bg-warning',
  ]

  function getColor(name: string): string {
    let hash = 0
    for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
    return colors[Math.abs(hash) % colors.length]
  }

  const filtered = search
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase())
      )
    : projects

  return (
    <div className="h-screen flex flex-col bg-base-100 text-base-content">
      {/* Header */}
      <div className="p-6 pb-4">
        <h1 className="text-2xl font-bold mb-4">Forge IDE</h1>
        <Flex align="center" gap="md">
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Button color="primary" onClick={handleOpen}>
            Open Folder
          </Button>
        </Flex>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-6">
        {filtered.length === 0 && (
          <div className="text-center text-base-content/40 mt-12">
            {projects.length === 0
              ? 'No recent projects. Click "Open Folder" to get started.'
              : 'No matching projects.'}
          </div>
        )}
        {filtered.map((project) => (
          <div
            key={project.path}
            className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-base-200 transition-colors"
            onClick={() => openProject(project.path)}
          >
            <div className={`w-9 h-9 rounded-lg ${getColor(project.name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
              {getInitials(project.name)}
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{project.name}</div>
              <div className="text-sm text-base-content/50 truncate">{project.path.replace(/^\/Users\/[^/]+/, '~')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
