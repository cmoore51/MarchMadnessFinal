import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MarchMadness from './march-madness-ncaa.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MarchMadness />
  </StrictMode>,
)
