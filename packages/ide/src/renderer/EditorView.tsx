import { useState, useEffect, useRef, useCallback } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useTheme, Tabs, Splitter } from 'asterui'
import { tsClient, pathToUri } from './lspClient'
import FileTree from './FileTree'

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

export default function EditorView({ projectPath }: { projectPath: string }) {
  const { theme } = useTheme()
  const monacoTheme = theme === 'forge-dark' ? 'vs-dark' : 'vs'
  const [files, setFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [projectRoot, setProjectRoot] = useState<string | null>(projectPath)
  const monacoRef = useRef<MonacoInstance | null>(null)
  const editorRef = useRef<EditorInstance | null>(null)
  const fileVersions = useRef<Map<string, number>>(new Map())

  // Start language servers on mount
  useEffect(() => {
    forge.startLanguageServers()
  }, [])

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

    // Register editor opener to handle navigation to files (references, etc.)
    const openerService = (editor as any)._codeEditorService
    if (openerService?.openCodeEditor) {
      const origOpen = openerService.openCodeEditor.bind(openerService)
      openerService.openCodeEditor = async (input: any, source: any, sideBySide: any) => {
        const uri = input?.resource
        if (uri) {
          const filePath = uri.path
          let model = monaco.editor.getModel(uri)
          if (!model) {
            try {
              const content = await forge.readFile(filePath)
              model = monaco.editor.createModel(content, getMonacoLanguageId(filePath), uri)
              openFile({ path: filePath, content })
            } catch {
              return origOpen(input, source, sideBySide)
            }
          }
          if (model) {
            editor.setModel(model)
            setActiveFile(filePath)
            if (input.options?.selection) {
              const sel = input.options.selection
              editor.setPosition({
                lineNumber: sel.startLineNumber,
                column: sel.startColumn,
              })
              editor.revealLineInCenter(sel.startLineNumber)
            }
            editor.focus()
            return editor
          }
        }
        return origOpen(input, source, sideBySide)
      }
    }

    // Disable Monaco's built-in TS/JS features that LSP replaces
    const disabledMode = {
      completionItems: true,  // keep — LSP adds on top
      hovers: false,          // disable — LSP provides these
      documentSymbols: true,  // keep
      definitions: false,     // disable — LSP provides these
      references: true,       // keep for now
      documentHighlights: true,
      rename: true,
      diagnostics: false,     // disable — LSP provides these
      documentRangeFormattingEdits: true,
      signatureHelp: true,
      onTypeFormattingEdits: true,
      codeActions: true,
      inlayHints: true,
    }
    monaco.languages.typescript.typescriptDefaults.setModeConfiguration(disabledMode)
    monaco.languages.typescript.javascriptDefaults.setModeConfiguration(disabledMode)
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

    // Go-to-definition: Cmd+click or Cmd+B
    // We handle navigation ourselves instead of returning locations to Monaco,
    // because Monaco can't open files that aren't loaded as models
    editor.addAction({
      id: 'lsp-goto-definition',
      label: 'Go to Definition',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
      run: async (ed) => {
        if (!tsClient.isInitialized) return
        const model = ed.getModel()
        const position = ed.getPosition()
        if (!model || !position) return

        try {
          const result = await tsClient.requestDefinition(
            model.uri.toString(),
            position.lineNumber - 1,
            position.column - 1,
          )
          if (!result) return
          const locations = Array.isArray(result) ? result : [result]
          if (locations.length === 0) return

          const loc = locations[0]
          const targetUri = monaco.Uri.parse(loc.uri)
          const filePath = targetUri.path
          const targetLine = loc.range.start.line + 1
          const targetCol = loc.range.start.character + 1

          // Ensure file is open
          let targetModel = monaco.editor.getModel(targetUri)
          if (!targetModel) {
            const content = await forge.readFile(filePath)
            targetModel = monaco.editor.createModel(content, getMonacoLanguageId(filePath), targetUri)
            openFile({ path: filePath, content })
          } else {
            setActiveFile(filePath)
          }

          // Switch to the model and jump to location
          ed.setModel(targetModel)
          ed.setPosition({ lineNumber: targetLine, column: targetCol })
          ed.revealLineInCenter(targetLine)
          ed.focus()
        } catch {}
      },
    })

    // Also register as a definition provider so Cmd+click works
    for (const lang of languages) {
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model, position) => {
          if (!tsClient.isInitialized) return null
          try {
            const result = await tsClient.requestDefinition(
              model.uri.toString(),
              position.lineNumber - 1,
              position.column - 1,
            )
            if (!result) return null
            const locations = Array.isArray(result) ? result : [result]

            // Pre-load any files that aren't open yet
            for (const loc of locations) {
              const targetUri = monaco.Uri.parse(loc.uri)
              if (!monaco.editor.getModel(targetUri)) {
                const filePath = targetUri.path
                try {
                  const content = await forge.readFile(filePath)
                  monaco.editor.createModel(content, getMonacoLanguageId(filePath), targetUri)
                  openFile({ path: filePath, content })
                } catch {}
              }
            }

            // After pre-loading, switch to the target file
            if (locations.length > 0) {
              const loc = locations[0]
              const filePath = monaco.Uri.parse(loc.uri).path
              setActiveFile(filePath)
              // Defer cursor positioning to after model switch
              setTimeout(() => {
                const targetLine = loc.range.start.line + 1
                const targetCol = loc.range.start.character + 1
                editor.setPosition({ lineNumber: targetLine, column: targetCol })
                editor.revealLineInCenter(targetLine)
              }, 50)
            }

            return locations.map((loc: any) => ({
              uri: monaco.Uri.parse(loc.uri),
              range: {
                startLineNumber: loc.range.start.line + 1,
                startColumn: loc.range.start.character + 1,
                endLineNumber: loc.range.end.line + 1,
                endColumn: loc.range.end.character + 1,
              },
            }))
          } catch {
            return null
          }
        },
      })
    }

    // Register LSP references provider for TS/JS
    for (const lang of languages) {
      monaco.languages.registerReferenceProvider(lang, {
        provideReferences: async (model, position) => {
          if (!tsClient.isInitialized) return null
          try {
            const result = await tsClient.requestReferences(
              model.uri.toString(),
              position.lineNumber - 1,
              position.column - 1,
            )
            if (!result) return null

            // Pre-load any files that aren't open yet
            for (const loc of result) {
              const targetUri = monaco.Uri.parse(loc.uri)
              if (!monaco.editor.getModel(targetUri)) {
                const filePath = targetUri.path
                try {
                  const content = await forge.readFile(filePath)
                  monaco.editor.createModel(content, getMonacoLanguageId(filePath), targetUri)
                  openFile({ path: filePath, content })
                } catch {}
              }
            }

            return result.map((loc: any) => ({
              uri: monaco.Uri.parse(loc.uri),
              range: {
                startLineNumber: loc.range.start.line + 1,
                startColumn: loc.range.start.character + 1,
                endLineNumber: loc.range.end.line + 1,
                endColumn: loc.range.end.character + 1,
              },
            }))
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

  const handleTreeFileClick = useCallback(async (filePath: string) => {
    // Don't reopen if already open
    if (files.some((f) => f.path === filePath)) {
      setActiveFile(filePath)
      switchToFile(filePath)
      return
    }
    const content = await forge.readFile(filePath)
    openFile({ path: filePath, content })
  }, [files, openFile, switchToFile])

  return (
    <div className="h-screen flex flex-col bg-base-100">
      <div className="flex-1 min-h-0">
        <Splitter direction="horizontal" className="h-full">
          <Splitter.Panel defaultSize={20} minSize={10} collapsible>
            <FileTree projectPath={projectPath} onFileClick={handleTreeFileClick} />
          </Splitter.Panel>
          <Splitter.Panel>
            <div className="flex flex-col h-full">
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
                    minimap: { enabled: true },
                    automaticLayout: true,
                  }}
                />
              </div>

              {files.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-base-content/40">
                  <span>⌘O to open a file or folder</span>
                </div>
              )}
            </div>
          </Splitter.Panel>
        </Splitter>
      </div>
    </div>
  )
}
