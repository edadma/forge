import Editor, { type OnMount } from '@monaco-editor/react'
import { useTheme } from 'asterui'

const handleMount: OnMount = async (_editor, monaco) => {
  const ts = monaco.languages.typescript.typescriptDefaults

  try {
    const res = await fetch('https://unpkg.com/@types/react@19.2.14/index.d.ts')
    if (res.ok) {
      const content = await res.text()
      // Wrap in declare module so imports resolve
      const wrapped = `declare module 'react' {\n${content}\n}`
      ts.addExtraLib(wrapped, 'file:///node_modules/@types/react/index.d.ts')
    }
  } catch {
    // Offline fallback — skip
  }
}

export default function App() {
  const { theme } = useTheme()
  const monacoTheme = theme === 'forge-dark' ? 'vs-dark' : 'vs'

  return (
    <div className="h-screen flex flex-col">
      <Editor
        defaultLanguage="typescript"
        defaultValue="// Start typing..."
        theme={monacoTheme}
        onMount={handleMount}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          automaticLayout: true,
        }}
      />
    </div>
  )
}
