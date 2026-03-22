import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'

let win: BrowserWindow | null = null

function createWindow() {
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
