// LSP Client — bridges between Monaco editor and language servers via IPC

const forge = (window as any).forge

type LspCallback = (msg: any) => void

interface LspChannel {
  send: (msg: any) => void
  onMessage: (callback: (msg: any) => void) => () => void
}

export class LspClient {
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (err: any) => void }>()
  private notificationHandlers = new Map<string, LspCallback[]>()
  private requestHandlers = new Map<string, (params: any) => any>()
  private initialized = false

  constructor(private name: string, private channel: LspChannel) {
    channel.onMessage((msg: any) => {
      if ('id' in msg && !('method' in msg)) {
        // Response to our request
        const pending = this.pendingRequests.get(msg.id)
        if (pending) {
          this.pendingRequests.delete(msg.id)
          if ('error' in msg) {
            pending.reject(msg.error)
          } else {
            pending.resolve(msg.result)
          }
        }
      } else if ('id' in msg && 'method' in msg) {
        // Request FROM the server (e.g., workspace/configuration)
        const handler = this.requestHandlers.get(msg.method)
        if (handler) {
          const result = handler(msg.params)
          channel.send({ jsonrpc: '2.0', id: msg.id, result })
        } else {
          console.warn(`${this.name}: unhandled server request: ${msg.method}`)
          channel.send({ jsonrpc: '2.0', id: msg.id, result: null })
        }
      } else if ('method' in msg) {
        // Notification from server
        const handlers = this.notificationHandlers.get(msg.method)
        if (handlers) {
          handlers.forEach((h) => h(msg.params))
        }
      }
    })
  }

  onRequest(method: string, handler: (params: any) => any) {
    this.requestHandlers.set(method, handler)
  }

  sendRequest(method: string, params: any): Promise<any> {
    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.channel.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  sendNotification(method: string, params: any) {
    this.channel.send({ jsonrpc: '2.0', method, params })
  }

  onNotification(method: string, callback: LspCallback) {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, [])
    }
    this.notificationHandlers.get(method)!.push(callback)
  }

  get isInitialized() {
    return this.initialized
  }

  async initialize(rootUri: string, capabilities: any = {}) {
    const result = await this.sendRequest('initialize', {
      processId: null,
      rootUri,
      capabilities,
    })
    this.sendNotification('initialized', {})
    this.initialized = true
    return result
  }

  didOpenDocument(uri: string, languageId: string, version: number, text: string) {
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text },
    })
  }

  didChangeDocument(uri: string, version: number, text: string) {
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    })
  }

  didCloseDocument(uri: string) {
    this.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    })
  }

  async requestCompletion(uri: string, line: number, character: number) {
    return this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line, character },
    })
  }

  async requestDefinition(uri: string, line: number, character: number) {
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    })
  }

  async requestHover(uri: string, line: number, character: number) {
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    })
  }

  async requestDiagnostics(uri: string) {
    return this.sendRequest('textDocument/diagnostic', {
      textDocument: { uri },
    })
  }
}

// Helper to convert file path to URI
export function pathToUri(filePath: string): string {
  return `file://${filePath}`
}

// Create TS language server client
export const tsClient = new LspClient('ts', forge.lspTs)
