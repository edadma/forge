import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'asterui'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <ThemeProvider defaultTheme="forge-dark">
    <App />
  </ThemeProvider>,
)
