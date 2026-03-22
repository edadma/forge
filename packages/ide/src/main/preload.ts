import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('forge', {
  platform: process.platform,
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
})
