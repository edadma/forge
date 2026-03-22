import { useEffect, useRef } from 'react'
import { LogLevel } from '@codingame/monaco-vscode-api'
import {
  InMemoryFileSystemProvider,
  registerFileSystemOverlay,
  type IFileWriteOptions,
} from '@codingame/monaco-vscode-files-service-override'
import '@codingame/monaco-vscode-javascript-default-extension'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import '@codingame/monaco-vscode-typescript-basics-default-extension'
import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-typescript-language-features-default-extension'
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp'
import {
  MonacoVscodeApiWrapper,
  type MonacoVscodeApiConfig,
} from 'monaco-languageclient/vscodeApiWrapper'
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory'
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import * as vscode from 'vscode'

const sampleCode = `const takesString = (x: string) => {};

// you should see an error marker in the next line
takesString(0);
`

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current || !containerRef.current) return
    initRef.current = true
    startEditor(containerRef.current)
  }, [])

  return <div ref={containerRef} style={{ height: '100vh' }} />
}

async function startEditor(htmlContainer: HTMLElement) {
  // Set up in-memory file system
  const textEncoder = new TextEncoder()
  const options: IFileWriteOptions = {
    atomic: false,
    unlock: false,
    create: true,
    overwrite: true,
  }
  const workspaceUri = vscode.Uri.file('/workspace')
  const workspaceFileUri = vscode.Uri.file('/workspace.code-workspace')
  const codeUri = vscode.Uri.file('/workspace/hello.ts')

  const fileSystemProvider = new InMemoryFileSystemProvider()
  await fileSystemProvider.mkdir(workspaceUri)
  await fileSystemProvider.writeFile(codeUri, textEncoder.encode(sampleCode), options)
  await fileSystemProvider.writeFile(
    workspaceFileUri,
    textEncoder.encode(JSON.stringify({ folders: [{ path: '/workspace' }] })),
    options,
  )
  registerFileSystemOverlay(1, fileSystemProvider)

  // Configure monaco-vscode-api
  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: 'extended',
    viewsConfig: {
      $type: 'EditorService',
      htmlContainer,
    },
    logLevel: LogLevel.Warning,
    advanced: {
      loadExtensionServices: false,
    },
    serviceOverrides: {
      ...getKeybindingsServiceOverride(),
      ...getExtensionServiceOverride({
        enableWorkerExtensionHost: true,
      }),
    },
    userConfiguration: {
      json: JSON.stringify({
        'workbench.colorTheme': 'Default Dark Modern',
        'editor.wordBasedSuggestions': 'off',
        'editor.minimap.enabled': false,
        'editor.fontSize': 14,
        'typescript.tsserver.web.projectWideIntellisense.enabled': true,
        'typescript.tsserver.web.projectWideIntellisense.suppressSemanticErrors': false,
      }),
    },
    workspaceConfig: {
      enableWorkspaceTrust: true,
      workspaceProvider: {
        trusted: true,
        async open() {
          return true
        },
        workspace: {
          workspaceUri: workspaceFileUri,
        },
      },
    },
    monacoWorkerFactory: configureDefaultWorkerFactory,
  }

  // Initialize the API wrapper
  const apiWrapper = new MonacoVscodeApiWrapper(vscodeApiConfig)
  await apiWrapper.start()

  // Create and start the editor
  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        text: sampleCode,
        uri: codeUri.path,
      },
    },
    useDiffEditor: false,
  }

  const editorApp = new EditorApp(editorAppConfig)
  await editorApp.start(htmlContainer)

  // Open the document
  await vscode.workspace.openTextDocument(codeUri)
}
