// LSP Client — bridges between Monaco editor and typescript-language-server via IPC

const forge = (window as any).forge

type LspCallback = (msg: any) => void

let requestId = 0
const pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (err: any) => void }>()
const notificationHandlers = new Map<string, LspCallback[]>()

// Listen for messages from the language server
forge.onLspMessage((msg: any) => {
  if ('id' in msg && !('method' in msg)) {
    // Response to a request
    const pending = pendingRequests.get(msg.id)
    if (pending) {
      pendingRequests.delete(msg.id)
      if ('error' in msg) {
        pending.reject(msg.error)
      } else {
        pending.resolve(msg.result)
      }
    }
  } else if ('method' in msg) {
    // Notification or request from server
    const handlers = notificationHandlers.get(msg.method)
    if (handlers) {
      handlers.forEach((h) => h(msg.params))
    }
  }
})

export function sendRequest(method: string, params: any): Promise<any> {
  const id = ++requestId
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject })
    forge.sendLspMessage({ jsonrpc: '2.0', id, method, params })
  })
}

export function sendNotification(method: string, params: any) {
  forge.sendLspMessage({ jsonrpc: '2.0', method, params })
}

export function onNotification(method: string, callback: LspCallback) {
  if (!notificationHandlers.has(method)) {
    notificationHandlers.set(method, [])
  }
  notificationHandlers.get(method)!.push(callback)
}

// Helper to convert file path to URI
export function pathToUri(filePath: string): string {
  return `file://${filePath}`
}

// Initialize the language server
export async function initializeLsp(rootPath: string) {
  const result = await sendRequest('initialize', {
    processId: null,
    rootUri: pathToUri(rootPath),
    capabilities: {
      textDocument: {
        synchronization: {
          didSave: true,
          dynamicRegistration: false,
        },
        completion: {
          completionItem: {
            snippetSupport: false,
          },
        },
        hover: {},
        publishDiagnostics: {
          relatedInformation: true,
        },
      },
    },
  })

  sendNotification('initialized', {})
  return result
}

// Document lifecycle
export function didOpenDocument(uri: string, languageId: string, version: number, text: string) {
  sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId, version, text },
  })
}

export function didChangeDocument(uri: string, version: number, text: string) {
  sendNotification('textDocument/didChange', {
    textDocument: { uri, version },
    contentChanges: [{ text }],
  })
}

export function didCloseDocument(uri: string) {
  sendNotification('textDocument/didClose', {
    textDocument: { uri },
  })
}

// Request completions
export async function requestCompletion(uri: string, line: number, character: number) {
  return sendRequest('textDocument/completion', {
    textDocument: { uri },
    position: { line, character },
  })
}

// Request hover
export async function requestHover(uri: string, line: number, character: number) {
  return sendRequest('textDocument/hover', {
    textDocument: { uri },
    position: { line, character },
  })
}
