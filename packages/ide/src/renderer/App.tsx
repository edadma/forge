import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { useTheme } from 'asterui'
import './userWorker'

export default function App() {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return

    const editor = monaco.editor.create(containerRef.current, {
      value: '// Start typing...',
      language: 'typescript',
      theme: theme === 'forge-dark' ? 'vs-dark' : 'vs',
      fontSize: 14,
      minimap: { enabled: false },
      automaticLayout: true,
    })

    editorRef.current = editor
    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (editorRef.current) {
      monaco.editor.setTheme(theme === 'forge-dark' ? 'vs-dark' : 'vs')
    }
  }, [theme])

  return <div ref={containerRef} className="h-screen" />
}
