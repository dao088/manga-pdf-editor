import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pdfjs-dist/web/pdf_viewer.css'
import './index.css'
// fonts bundled with the app (same files are embedded in the exported PDF, so preview == export)
import '@fontsource/anton/400.css'
import '@fontsource/bangers/400.css'
import '@fontsource/patrick-hand/400.css'
import '@fontsource/comic-neue/400.css'
import '@fontsource/comic-neue/400-italic.css'
import '@fontsource/comic-neue/700.css'
import '@fontsource/comic-neue/700-italic.css'
import '@fontsource/bodoni-moda/400.css'
import '@fontsource/bodoni-moda/400-italic.css'
import '@fontsource/bodoni-moda/700.css'
import '@fontsource/bodoni-moda/700-italic.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
