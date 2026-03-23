import ProjectLauncher from './ProjectLauncher'
import EditorView from './EditorView'

const params = new URLSearchParams(window.location.search)
const windowType = params.get('window') || 'launcher'
const projectPath = params.get('project') ? decodeURIComponent(params.get('project')!) : null

export default function App() {
  if (windowType === 'editor' && projectPath) {
    return <EditorView projectPath={projectPath} />
  }

  return <ProjectLauncher />
}
