import { contextBridge, ipcRenderer } from 'electron'

function createLspChannel(channel: string) {
  return {
    send: (msg: any) => ipcRenderer.send(channel, msg),
    onMessage: (callback: (msg: any) => void) => {
      const listener = (_event: unknown, msg: any) => callback(msg)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  }
}

contextBridge.exposeInMainWorld('forge', {
  platform: process.platform,
  onFolderOpened: (callback: (folderPath: string) => void) => {
    const listener = (_event: unknown, folderPath: string) => callback(folderPath)
    ipcRenderer.on('folder-opened', listener)
    return () => ipcRenderer.removeListener('folder-opened', listener)
  },
  onFileOpened: (callback: (file: { path: string; content: string }) => void) => {
    const listener = (_event: unknown, file: { path: string; content: string }) => callback(file)
    ipcRenderer.on('file-opened', listener)
    return () => ipcRenderer.removeListener('file-opened', listener)
  },
  onSaveFile: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('save-file', listener)
    return () => ipcRenderer.removeListener('save-file', listener)
  },
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  // LSP channels
  lspTs: createLspChannel('lsp-ts'),
  // ESLint
  lintFile: (uri: string, filePath: string, rootPath: string) =>
    ipcRenderer.send('eslint-lint', { uri, filePath, rootPath }),
  onEslintDiagnostics: (callback: (data: { uri: string; diagnostics: any[] }) => void) => {
    const listener = (_event: unknown, data: any) => callback(data)
    ipcRenderer.on('eslint-diagnostics', listener)
    return () => ipcRenderer.removeListener('eslint-diagnostics', listener)
  },
})
