import { app, BrowserWindow, Menu, dialog, ipcMain, session } from 'electron'
import path from 'path'
import fs from 'fs/promises'

let win: BrowserWindow | null = null

function createWindow() {
  // Set headers for SharedArrayBuffer support (needed by TS language features)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['credentialless'],
        'Cross-Origin-Resource-Policy': ['cross-origin'],
      },
    })
  })

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win!.show())

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
    win.webContents.openDevTools()
  }
}

// Menu
const template: Electron.MenuItemConstructorOptions[] = [
  {
    label: app.name,
    submenu: [{ role: 'quit' }],
  },
  {
    label: 'File',
    submenu: [
      {
        label: 'Open File...',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          if (!win) return
          const result = await dialog.showOpenDialog(win, {
            properties: ['openFile', 'multiSelections'],
            filters: [
              { name: 'TypeScript', extensions: ['ts', 'tsx', 'js', 'jsx', 'json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          })
          if (!result.canceled) {
            for (const filePath of result.filePaths) {
              const content = await fs.readFile(filePath, 'utf-8')
              win!.webContents.send('file-opened', { path: filePath, content })
            }
          }
        },
      },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => {
          if (win) win.webContents.send('save-file')
        },
      },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  },
]

// IPC: save file
ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf-8')
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
