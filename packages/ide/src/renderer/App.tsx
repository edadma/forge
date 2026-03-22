import Editor from '@monaco-editor/react'
import { useTheme } from 'asterui'

export default function App() {
  const { theme } = useTheme()
  const monacoTheme = theme === 'forge-dark' ? 'vs-dark' : 'vs'

  return (
    <div className="h-screen flex flex-col">
      <Editor
        defaultLanguage="typescript"
        defaultValue="// Start typing..."
        theme={monacoTheme}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          automaticLayout: true,
        }}
      />
    </div>
  )
}
