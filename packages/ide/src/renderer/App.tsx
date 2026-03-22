import { useState, useEffect, useRef, useCallback } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useTheme, Tabs } from 'asterui'
import { tsClient, pathToUri } from './lspClient'

type MonacoInstance = Parameters<OnMount>[1]
type EditorInstance = Parameters<OnMount>[0]

interface OpenFile {
  path: string
  content: string
  version: number
}

const forge = (window as any).forge

// Language ID for the LSP (needs exact tsx/jsx distinction)
function getLspLanguageId(filePath: string): string {
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

// Language ID for Monaco editor (tsx/jsx mapped to ts/js for proper highlighting)
function getMonacoLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()
  switch (ext) {
    case 'ts': case 'tsx': return 'typescript'
    case 'js': case 'jsx': return 'javascript'
    case 'json': return 'json'
    case 'css': return 'css'
    case 'html': return 'html'
    default: return 'plaintext'
  }
}

// Map LSP severity to Monaco severity
function lspSeverityToMonaco(severity: number, monaco: MonacoInstance) {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error
    case 2: return monaco.MarkerSeverity.Warning
    case 3: return monaco.MarkerSeverity.Info
    case 4: return monaco.MarkerSeverity.Hint
    default: return monaco.MarkerSeverity.Error
  }
}

export default function App() {
  const { theme } = useTheme()
  const monacoTheme = theme === 'forge-dark' ? 'vs-dark' : 'vs'
  const [files, setFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [projectRoot, setProjectRoot] = useState<string | null>(null)
  const monacoRef = useRef<MonacoInstance | null>(null)
  const editorRef = useRef<EditorInstance | null>(null)
  const fileVersions = useRef<Map<string, number>>(new Map())

  const switchToFile = useCallback((filePath: string) => {
    if (!monacoRef.current || !editorRef.current) return
    const uri = monacoRef.current.Uri.parse(pathToUri(filePath))
    const model = monacoRef.current.editor.getModel(uri)
    if (model) {
      editorRef.current.setModel(model)
    }
  }, [])

  const openFile = useCallback((file: { path: string; content: string }) => {
    setFiles((prev) => {
      if (prev.some((f) => f.path === file.path)) {
        setActiveFile(file.path)
        switchToFile(file.path)
        return prev
      }
      return [...prev, { ...file, version: 1 }]
    })
    setActiveFile(file.path)

    if (monacoRef.current) {
      const uri = monacoRef.current.Uri.parse(pathToUri(file.path))
      const existing = monacoRef.current.editor.getModel(uri)
      if (!existing) {
        monacoRef.current.editor.createModel(file.content, getMonacoLanguageId(file.path), uri)
      }
      switchToFile(file.path)
    }

    // Notify both language servers
    const uri = pathToUri(file.path)
    const langId = getLspLanguageId(file.path)
    fileVersions.current.set(file.path, 1)
    if (tsClient.isInitialized) {
      tsClient.didOpenDocument(uri, langId, 1, file.content)
    }
    // Trigger ESLint
    if (projectRoot) {
      forge.lintFile(uri, file.path, projectRoot)
    }
  }, [switchToFile])

  // Listen for folder opened
  useEffect(() => {
    if (!forge?.onFolderOpened) return
    return forge.onFolderOpened((folderPath: string) => {
      setProjectRoot(folderPath)
    })
  }, [])

  // Initialize language servers when project root is set
  useEffect(() => {
    if (!projectRoot) return

    const rootUri = pathToUri(projectRoot)

    // Initialize TS server
    if (!tsClient.isInitialized) {
      tsClient.initialize(rootUri, {
        textDocument: {
          synchronization: { didSave: true },
          completion: { completionItem: { snippetSupport: false } },
          hover: {},
          publishDiagnostics: { relatedInformation: true },
        },
      }).then(() => {
        files.forEach((f) => {
          tsClient.didOpenDocument(pathToUri(f.path), getLspLanguageId(f.path), f.version, f.content)
        })
      }).catch((err) => console.error('TS LSP init failed:', err))
    }

    // Lint all open files with ESLint
    files.forEach((f) => {
      forge.lintFile(pathToUri(f.path), f.path, projectRoot)
    })
  }, [projectRoot, files])

  // Auto-init from first file's directory if no folder opened
  useEffect(() => {
    if (files.length > 0 && !projectRoot) {
      setProjectRoot(files[0].path.substring(0, files[0].path.lastIndexOf('/')))
    }
  }, [files, projectRoot])

  // Listen for files opened
  useEffect(() => {
    if (!forge?.onFileOpened) return
    return forge.onFileOpened((file: { path: string; content: string }) => openFile(file))
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

    // Disable Monaco's built-in TS/JS diagnostics — LSP handles these
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    })
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    })

    // Listen for diagnostics from TS server
    tsClient.onNotification('textDocument/publishDiagnostics', (params: any) => {
      const uri = monaco.Uri.parse(params.uri)
      const model = monaco.editor.getModel(uri)
      if (!model) return

      const markers = (params.diagnostics || []).map((d: any) => ({
        severity: lspSeverityToMonaco(d.severity, monaco),
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        source: d.source || 'ts',
        code: d.code?.toString(),
      }))
      monaco.editor.setModelMarkers(model, 'ts', markers)
    })

    // Listen for ESLint diagnostics (from direct runner)
    forge.onEslintDiagnostics((data: { uri: string; diagnostics: any[] }) => {
      const uri = monaco.Uri.parse(data.uri)
      const model = monaco.editor.getModel(uri)
      if (!model) return

      const markers = data.diagnostics.map((d: any) => ({
        severity: lspSeverityToMonaco(d.severity, monaco),
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        source: 'eslint',
        code: d.code?.toString(),
      }))
      monaco.editor.setModelMarkers(model, 'eslint', markers)
    })

    // Register LSP completion provider for TS/JS
    const languages = ['typescript', 'javascript']
    for (const lang of languages) {
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', '"', "'", '/', '<'],
        provideCompletionItems: async (model, position) => {
          if (!tsClient.isInitialized) return { suggestions: [] }
          try {
            const result = await tsClient.requestCompletion(
              model.uri.toString(),
              position.lineNumber - 1,
              position.column - 1,
            )
            if (!result) return { suggestions: [] }
            const items = Array.isArray(result) ? result : result.items || []
            return {
              suggestions: items.map((item: any) => ({
                label: item.label,
                kind: item.kind ?? monaco.languages.CompletionItemKind.Text,
                insertText: item.insertText || item.label,
                detail: item.detail,
                documentation: item.documentation,
                sortText: item.sortText,
                filterText: item.filterText,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column - (item.textEdit?.range
                    ? position.column - 1 - item.textEdit.range.start.character
                    : 0),
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              })),
            }
          } catch {
            return { suggestions: [] }
          }
        },
      })
    }

    // Register LSP hover provider for TS/JS (replaces Monaco's built-in)
    for (const lang of languages) {
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model, position) => {
          if (!tsClient.isInitialized) return null
          try {
            const result = await tsClient.requestHover(
              model.uri.toString(),
              position.lineNumber - 1,
              position.column - 1,
            )
            if (!result?.contents) return null
            const contents = Array.isArray(result.contents)
              ? result.contents.map((c: any) =>
                  typeof c === 'string' ? { value: c } : { value: c.value }
                )
              : [{ value: typeof result.contents === 'string' ? result.contents : result.contents.value }]
            return {
              contents,
              range: result.range ? {
                startLineNumber: result.range.start.line + 1,
                startColumn: result.range.start.character + 1,
                endLineNumber: result.range.end.line + 1,
                endColumn: result.range.end.character + 1,
              } : undefined,
            }
          } catch {
            return null
          }
        },
      })
    }

    // Track content changes and notify TS LSP + ESLint
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel()
      if (!model) return
      const filePath = model.uri.path
      const version = (fileVersions.current.get(filePath) || 1) + 1
      fileVersions.current.set(filePath, version)
      const uri = model.uri.toString()
      if (tsClient.isInitialized) {
        tsClient.didChangeDocument(uri, version, model.getValue())
      }
      // Re-lint with ESLint (debounced by saving to disk first would be better,
      // but for now lint on every change)
      if (projectRoot) {
        forge.lintFile(uri, filePath, projectRoot)
      }
    })
  }

  const closeTab = (filePath: string) => {
    if (monacoRef.current) {
      const uri = monacoRef.current.Uri.parse(pathToUri(filePath))
      const model = monacoRef.current.editor.getModel(uri)
      if (model) model.dispose()
    }

    const docUri = pathToUri(filePath)
    if (tsClient.isInitialized) tsClient.didCloseDocument(docUri)

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
          <span>⌘⇧O to open a folder, ⌘O to open a file</span>
        </div>
      )}
    </div>
  )
}
