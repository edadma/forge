import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { spawn, execFile, type ChildProcess } from 'child_process'
import {
  StreamMessageReader,
  StreamMessageWriter,
  type Message,
} from 'vscode-jsonrpc/node'
import { db, projects, projectState, initDb } from './db'
import { eq } from '@petradb/quarry'

// --- Launcher window (singleton, show/hide) ---

let launcherWin: BrowserWindow | null = null

function createLauncherWindow() {
  launcherWin = new BrowserWindow({
    width: 600,
    height: 500,
    show: false,
    title: 'Forge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  launcherWin.once('ready-to-show', () => launcherWin!.show())

  if (process.env.NODE_ENV === 'development') {
    launcherWin.loadURL('http://localhost:5173?window=launcher')
    launcherWin.webContents.openDevTools()
  } else {
    launcherWin.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { window: 'launcher' },
    })
  }

  // Prevent the launcher from being destroyed when project windows are open — just hide it
  launcherWin.on('close', (e) => {
    if (projectWindows.size > 0) {
      e.preventDefault()
      launcherWin!.hide()
    }
  })
}

function showLauncher() {
  if (launcherWin) {
    launcherWin.show()
    launcherWin.focus()
  }
}

// --- Project windows ---

const projectWindows = new Map<number, ProjectWindow>() // keyed by webContents.id

class ProjectWindow {
  win: BrowserWindow
  projectPath: string
  servers: { name: string; process: ChildProcess }[] = []
  lspWriters = new Map<string, StreamMessageWriter>()

  constructor(projectPath: string) {
    this.projectPath = projectPath

    this.win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      title: path.basename(projectPath),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    this.win.once('ready-to-show', () => this.win.show())

    const encodedPath = encodeURIComponent(projectPath)
    if (process.env.NODE_ENV === 'development') {
      this.win.loadURL(`http://localhost:5173?window=editor&project=${encodedPath}`)
    } else {
      this.win.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { window: 'editor', project: projectPath },
      })
    }

    projectWindows.set(this.win.webContents.id, this)

    this.win.on('closed', () => {
      this.killServers()
      projectWindows.delete(this.win.webContents.id)

      if (projectWindows.size === 0) {
        showLauncher()
      }
    })
  }

  startLanguageServers() {
    if (this.servers.length > 0) return

    this.startServer(
      'typescript-language-server',
      path.resolve(__dirname, '../../node_modules/.bin/typescript-language-server'),
      ['--stdio'],
      'lsp-ts',
    )
  }

  private startServer(name: string, binPath: string, args: string[], ipcChannel: string) {
    const serverProcess = spawn(binPath, args)
    this.servers.push({ name, process: serverProcess })

    const reader = new StreamMessageReader(serverProcess.stdout!)
    const writer = new StreamMessageWriter(serverProcess.stdin!)

    reader.listen((msg) => {
      if (!this.win.isDestroyed()) {
        this.win.webContents.send(ipcChannel, msg)
      }
    })

    this.lspWriters.set(ipcChannel, writer)

    serverProcess.on('exit', (code) => {
      console.log(`${name} (${path.basename(this.projectPath)}) exited with code ${code}`)
    })

    serverProcess.stderr?.on('data', (data) => {
      console.error(`${name} stderr: ${data}`)
    })
  }

  killServers() {
    this.servers.forEach((s) => s.process.kill())
    this.servers = []
    this.lspWriters.clear()
  }
}

function openProject(projectPath: string) {
  // Focus existing window if already open
  for (const pw of projectWindows.values()) {
    if (pw.projectPath === projectPath) {
      pw.win.focus()
      return
    }
  }

  if (launcherWin) launcherWin.hide()

  // Record in database
  const name = path.basename(projectPath)
  const now = new Date().toISOString()
  db.insert(projects).values({ name, path: projectPath, lastOpened: now }).execute().catch(() => {
    db.update(projects).set({ lastOpened: now }).where(eq(projects.path, projectPath)).execute()
  })

  new ProjectWindow(projectPath)
}

function getProjectWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): ProjectWindow | null {
  return projectWindows.get(event.sender.id) || null
}

// --- IPC: LSP message forwarding (routed by sender) ---

ipcMain.on('lsp-ts', (event, msg: Message) => {
  const pw = getProjectWindow(event)
  if (pw) {
    const writer = pw.lspWriters.get('lsp-ts')
    if (writer) writer.write(msg)
  }
})

// --- IPC: ESLint (routed by sender) ---

ipcMain.on('eslint-lint', (event, data: { uri: string; filePath: string; rootPath: string }) => {
  const pw = getProjectWindow(event)
  if (!pw) return
  try {
    const eslintBin = path.join(data.rootPath, 'node_modules/.bin/eslint')
    execFile(eslintBin, [data.filePath, '--format', 'json'], {
      cwd: data.rootPath,
    }, (_error, stdout) => {
      try {
        const results = JSON.parse(stdout)
        const diagnostics = results.length > 0
          ? results[0].messages.map((msg: any) => ({
              range: {
                start: { line: (msg.line || 1) - 1, character: (msg.column || 1) - 1 },
                end: { line: (msg.endLine || msg.line || 1) - 1, character: (msg.endColumn || msg.column || 1) - 1 },
              },
              severity: msg.severity === 2 ? 1 : 2,
              message: msg.message,
              source: 'eslint',
              code: msg.ruleId,
            }))
          : []
        if (!pw.win.isDestroyed()) {
          pw.win.webContents.send('eslint-diagnostics', { uri: data.uri, diagnostics })
        }
      } catch {
        if (!pw.win.isDestroyed()) {
          pw.win.webContents.send('eslint-diagnostics', { uri: data.uri, diagnostics: [] })
        }
      }
    })
  } catch (err) {
    console.error('ESLint runner error:', err)
  }
})

// --- IPC: start language servers (routed by sender) ---

ipcMain.handle('start-language-servers', (event) => {
  const pw = getProjectWindow(event)
  if (pw) pw.startLanguageServers()
})

// --- IPC: open project (from launcher) ---

ipcMain.handle('open-project', async (_event, projectPath: string) => {
  openProject(projectPath)
})

ipcMain.handle('open-folder-dialog', async () => {
  const parent = launcherWin || undefined
  const result = await dialog.showOpenDialog(parent!, {
    properties: ['openDirectory'],
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// --- IPC: database operations ---

ipcMain.handle('db-init', () => initDb())

ipcMain.handle('db-get-projects', async () => {
  return db.from(projects).execute()
})

ipcMain.handle('db-add-project', async (_event, name: string, projectPath: string) => {
  const now = new Date().toISOString()
  try {
    await db.insert(projects).values({ name, path: projectPath, lastOpened: now }).execute()
  } catch {
    await db.update(projects).set({ lastOpened: now }).where(eq(projects.path, projectPath)).execute()
  }
})

ipcMain.handle('db-remove-project', async (_event, projectPath: string) => {
  await db.delete(projects).where(eq(projects.path, projectPath)).execute()
})

ipcMain.handle('db-get-project-state', async (_event, projectPath: string) => {
  const rows = await db.from(projectState).where(eq(projectState.projectPath, projectPath)).execute()
  return rows.length > 0 ? rows[0] : null
})

ipcMain.handle('db-save-project-state', async (_event, state: {
  projectPath: string
  openFiles: string
  activeFile: string | null
  windowBounds: string | null
  splitterPositions: string | null
}) => {
  const existing = await db.from(projectState).where(eq(projectState.projectPath, state.projectPath)).execute()
  if (existing.length > 0) {
    await db.update(projectState).set({
      openFiles: state.openFiles,
      activeFile: state.activeFile,
      windowBounds: state.windowBounds,
      splitterPositions: state.splitterPositions,
    }).where(eq(projectState.projectPath, state.projectPath)).execute()
  } else {
    await db.insert(projectState).values(state).execute()
  }
})

// --- IPC: file operations ---

ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf-8')
})

ipcMain.handle('read-file', async (_event, filePath: string) => {
  return fs.readFile(filePath, 'utf-8')
})

ipcMain.handle('read-directory', async (_event, dirPath: string) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      path: path.join(dirPath, e.name),
      isDirectory: e.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
})

// --- Menu ---

const template: Electron.MenuItemConstructorOptions[] = [
  {
    label: app.name,
    submenu: [{ role: 'quit' }],
  },
  {
    label: 'File',
    submenu: [
      {
        label: 'Open...',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          const parent = BrowserWindow.getFocusedWindow() || undefined
          const result = await dialog.showOpenDialog(parent!, {
            properties: ['openFile', 'openDirectory', 'multiSelections'],
            filters: [
              { name: 'Source Files', extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          })
          if (!result.canceled) {
            for (const filePath of result.filePaths) {
              const stat = await fs.stat(filePath)
              if (stat.isDirectory()) {
                openProject(filePath)
              } else {
                // Open file in focused project window
                const focused = BrowserWindow.getFocusedWindow()
                if (focused) {
                  const content = await fs.readFile(filePath, 'utf-8')
                  focused.webContents.send('file-opened', { path: filePath, content })
                }
              }
            }
          }
        },
      },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => {
          const focused = BrowserWindow.getFocusedWindow()
          if (focused) focused.webContents.send('save-file')
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

// --- App lifecycle ---

app.whenReady().then(async () => {
  await initDb()
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  createLauncherWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (projectWindows.size === 0) {
    if (launcherWin) {
      showLauncher()
    } else {
      createLauncherWindow()
    }
  }
})
