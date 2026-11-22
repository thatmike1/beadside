// entry: react-query provider around the board

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app'
// the atlas theme's fonts ship with the board, so it renders the same offline; a face only
// downloads once a rule uses it, so the default theme never fetches Rubik
import '@fontsource-variable/rubik'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles.css'
import './theme-atlas.css'

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
})

const root = document.getElementById('root')
if (!root) throw new Error('no #root in index.html')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
