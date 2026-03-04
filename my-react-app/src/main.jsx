import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MarchMadness from './MarchMadnessNcaa.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MarchMadness />
  </StrictMode>,
)
