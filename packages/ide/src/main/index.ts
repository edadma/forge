import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { spawn, type ChildProcess } from 'child_process'
import {
  StreamMessageReader,
  StreamMessageWriter,
  type Message,
} from 'vscode-jsonrpc/node'

let win: BrowserWindow | null = null
let lsProcess: ChildProcess | null = null

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

// Language Server
function startLanguageServer() {
  const lsPath = path.resolve(
    __dirname,
    '../../node_modules/.bin/typescript-language-server',
  )
  lsProcess = spawn(lsPath, ['--stdio'])

  const reader = new StreamMessageReader(lsProcess.stdout!)
  const writer = new StreamMessageWriter(lsProcess.stdin!)

  // Forward LS → renderer
  reader.listen((msg) => {
    if (win) {
      win.webContents.send('lsp-message', msg)
    }
  })

  // Forward renderer → LS
  ipcMain.on('lsp-message', (_event: any, msg: Message) => {
    writer.write(msg)
  })

  lsProcess.on('exit', (code) => {
    console.log(`Language server exited with code ${code}`)
    lsProcess = null
  })

  lsProcess.stderr?.on('data', (data) => {
    console.error(`LS stderr: ${data}`)
  })
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
        label: 'Open Folder...',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: async () => {
          if (!win) return
          const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
          })
          if (!result.canceled && result.filePaths.length > 0) {
            win.webContents.send('folder-opened', result.filePaths[0])
          }
        },
      },
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
  startLanguageServer()
})

app.on('window-all-closed', () => {
  lsProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
