import { useState } from 'react'
import ProjectLauncher from './ProjectLauncher'
import EditorView from './EditorView'

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null)

  if (projectPath) {
    return <EditorView projectPath={projectPath} />
  }

  return <ProjectLauncher onOpenProject={setProjectPath} />
}
