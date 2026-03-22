import { app } from 'electron'
import path from 'path'
import { mkdirSync } from 'fs'
import { Session } from '@petradb/engine'
import { quarry, table, serial, text, integer } from '@petradb/quarry'

// Database — memory in dev, file-backed in production
const isDev = process.env.NODE_ENV === 'development'
const dbDir = path.join(app.getPath('userData'), 'db')
if (!isDev) try { mkdirSync(dbDir, { recursive: true }) } catch {}

const session = isDev
  ? new Session({ storage: 'memory' })
  : new Session({ storage: 'persistent', path: path.join(dbDir, 'forge.db') })

export const db = quarry(session)

// Schema
export const projects = table('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  lastOpened: text('last_opened').notNull(),
})

export const projectState = table('project_state', {
  id: serial('id').primaryKey(),
  projectPath: text('project_path').notNull().unique(),
  openFiles: text('open_files').notNull().default('[]'),       // JSON array of file paths
  activeFile: text('active_file'),                               // currently active tab
  windowBounds: text('window_bounds'),                           // JSON: {x, y, width, height}
  splitterPositions: text('splitter_positions'),                 // JSON object
})

export async function initDb() {
  try {
    await db.createTable(projects)
  } catch {
    // Table already exists
  }
  try {
    await db.createTable(projectState)
  } catch {
    // Table already exists
  }
}
