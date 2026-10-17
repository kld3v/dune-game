import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initGame, installDebug, loadSettings } from './game/sim'

loadSettings()
initGame()
installDebug()

// No StrictMode: its double-mount would build the GPU resources twice.
createRoot(document.getElementById('root')!).render(<App />)
