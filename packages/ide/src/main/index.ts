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
const servers: { name: string; process: ChildProcess }[] = []

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

// Generic language server launcher
function startServer(name: string, binPath: string, args: string[], ipcChannel: string) {
  const serverProcess = spawn(binPath, args)
  servers.push({ name, process: serverProcess })

  const reader = new StreamMessageReader(serverProcess.stdout!)
  const writer = new StreamMessageWriter(serverProcess.stdin!)

  // Forward LS → renderer
  reader.listen((msg) => {
    if (win) {
      win.webContents.send(ipcChannel, msg)
    }
  })

  // Forward renderer → LS
  ipcMain.on(ipcChannel, (_event: any, msg: Message) => {
    writer.write(msg)
  })

  serverProcess.on('exit', (code) => {
    console.log(`${name} exited with code ${code}`)
  })

  serverProcess.stderr?.on('data', (data) => {
    console.error(`${name} stderr: ${data}`)
  })
}

function startLanguageServers() {
  // TypeScript language server
  startServer(
    'typescript-language-server',
    path.resolve(__dirname, '../../node_modules/.bin/typescript-language-server'),
    ['--stdio'],
    'lsp-ts',
  )

  // ESLint — run directly via project's eslint
  startEslintRunner()
}

// ESLint runner — executes project's eslint on files and sends diagnostics
function startEslintRunner() {
  // Listen for lint requests from renderer
  ipcMain.on('eslint-lint', async (_event, data: { uri: string; filePath: string; rootPath: string }) => {
    if (!win) return
    try {
      const { execFile } = await import('child_process')
      const eslintBin = path.join(data.rootPath, 'node_modules/.bin/eslint')

      execFile(eslintBin, [data.filePath, '--format', 'json'], {
        cwd: data.rootPath,
      }, (error, stdout) => {
        try {
          // eslint exits with code 1 when there are lint errors, which is normal
          const results = JSON.parse(stdout)
          if (results.length > 0) {
            const diagnostics = results[0].messages.map((msg: any) => ({
              range: {
                start: { line: (msg.line || 1) - 1, character: (msg.column || 1) - 1 },
                end: { line: (msg.endLine || msg.line || 1) - 1, character: (msg.endColumn || msg.column || 1) - 1 },
              },
              severity: msg.severity === 2 ? 1 : 2, // 2=error→1, 1=warning→2
              message: msg.message,
              source: 'eslint',
              code: msg.ruleId,
            }))
            win!.webContents.send('eslint-diagnostics', { uri: data.uri, diagnostics })
          } else {
            win!.webContents.send('eslint-diagnostics', { uri: data.uri, diagnostics: [] })
          }
        } catch {
          // JSON parse failed or no results
          win!.webContents.send('eslint-diagnostics', { uri: data.uri, diagnostics: [] })
        }
      })
    } catch (err) {
      console.error('ESLint runner error:', err)
    }
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
  startLanguageServers()
})

app.on('window-all-closed', () => {
  servers.forEach((s) => s.process.kill())
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
