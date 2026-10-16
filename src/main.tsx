import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode removed - causes double-mounts that break R3F state
createRoot(document.getElementById('root')!).render(<App />)
