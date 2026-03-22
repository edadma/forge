import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('forge', {
  platform: process.platform,
})
