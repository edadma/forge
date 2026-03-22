import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'configure-response-headers',
      apply: 'serve',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
          next()
        })
      },
    },
  ],
  root: 'src/renderer',
  base: './',
  server: {
    fs: {
      strict: false,
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: [
      'vscode/localExtensionHost',
    ],
  },
})
