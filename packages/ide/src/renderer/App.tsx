import { useState, useEffect, useRef, useCallback } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useTheme, Tabs } from 'asterui'

type MonacoInstance = Parameters<OnMount>[1]
type EditorInstance = Parameters<OnMount>[0]

interface OpenFile {
  path: string
  content: string
}

const forge = (window as any).forge

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()
  switch (ext) {
    case 'ts': return 'typescript'
    case 'tsx': return 'typescriptreact'
    case 'js': return 'javascript'
    case 'jsx': return 'javascriptreact'
    case 'json': return 'json'
    case 'css': return 'css'
    case 'html': return 'html'
    default: return 'plaintext'
  }
}

export default function App() {
  const { theme } = useTheme()
  const monacoTheme = theme === 'forge-dark' ? 'vs-dark' : 'vs'
  const [files, setFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const monacoRef = useRef<MonacoInstance | null>(null)
  const editorRef = useRef<EditorInstance | null>(null)
  const mountedRef = useRef(false)

  const switchToFile = useCallback((filePath: string) => {
    if (!monacoRef.current || !editorRef.current) return
    const uri = monacoRef.current.Uri.parse(`file://${filePath}`)
    const model = monacoRef.current.editor.getModel(uri)
    if (model) {
      editorRef.current.setModel(model)
    }
  }, [])

  const openFile = useCallback((file: OpenFile) => {
    setFiles((prev) => {
      if (prev.some((f) => f.path === file.path)) {
        // Already open, just switch to it
        setActiveFile(file.path)
        switchToFile(file.path)
        return prev
      }
      return [...prev, file]
    })
    setActiveFile(file.path)

    // Create Monaco model if needed
    if (monacoRef.current) {
      const uri = monacoRef.current.Uri.parse(`file://${file.path}`)
      const existing = monacoRef.current.editor.getModel(uri)
      if (!existing) {
        monacoRef.current.editor.createModel(file.content, getLanguage(file.path), uri)
      }
      switchToFile(file.path)
    }
  }, [switchToFile])

  // Listen for files opened from native menu
  useEffect(() => {
    if (!forge?.onFileOpened) return
    return forge.onFileOpened((file: OpenFile) => openFile(file))
  }, [openFile])

  // Listen for save
  useEffect(() => {
    if (!forge?.onSaveFile) return
    return forge.onSaveFile(() => {
      if (activeFile && editorRef.current && forge.writeFile) {
        forge.writeFile(activeFile, editorRef.current.getValue())
      }
    })
  }, [activeFile])

  const handleMount: OnMount = async (editor, monaco) => {
    monacoRef.current = monaco
    editorRef.current = editor
    mountedRef.current = true

    // Load React types
    try {
      const res = await fetch('https://unpkg.com/@types/react@19.2.14/index.d.ts')
      if (res.ok) {
        const content = await res.text()
        const wrapped = `declare module 'react' {\n${content}\n}`
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
          wrapped,
          'file:///node_modules/@types/react/index.d.ts',
        )
      }
    } catch {}
  }

  const closeTab = (filePath: string) => {
    if (monacoRef.current) {
      const uri = monacoRef.current.Uri.parse(`file://${filePath}`)
      const model = monacoRef.current.editor.getModel(uri)
      if (model) model.dispose()
    }

    const remaining = files.filter((f) => f.path !== filePath)
    setFiles(remaining)
    if (activeFile === filePath) {
      const next = remaining.length > 0 ? remaining[remaining.length - 1].path : null
      setActiveFile(next)
      if (next) switchToFile(next)
    }
  }

  const fileName = (p: string) => p.split('/').pop() || p

  return (
    <div className="h-screen flex flex-col bg-base-100">
      {/* Tab bar */}
      {files.length > 0 && (
        <div className="shrink-0">
          <Tabs
            items={files.map((f) => ({
              key: f.path,
              label: (
                <span className="flex items-center gap-1">
                  {fileName(f.path)}
                  <span
                    className="opacity-50 hover:opacity-100 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(f.path)
                    }}
                  >
                    ×
                  </span>
                </span>
              ),
              children: null,
            }))}
            activeKey={activeFile || undefined}
            onChange={(key) => {
              setActiveFile(key)
              switchToFile(key)
            }}
            variant="border"
            size="sm"
          />
        </div>
      )}

      {/* Editor */}
      <div className="flex-1" style={{ display: files.length > 0 ? 'block' : 'none' }}>
        <Editor
          theme={monacoTheme}
          onMount={handleMount}
          defaultLanguage="typescript"
          defaultValue=""
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            automaticLayout: true,
          }}
        />
      </div>

      {files.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-base-content/40">
          <span>⌘O to open a file</span>
        </div>
      )}
    </div>
  )
}
