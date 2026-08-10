import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './index.css'
import { Notificari } from './ui/Notificari.js'

/**
 * `refetchOnWindowFocus` is off deliberately.
 *
 * The recipe editor holds forty transcribed lines in component state and
 * replaces them with whatever the server last said when the query refetches.
 * Alt-tabbing to look something up in SAGA would have thrown the work away.
 * The editor guards against this itself as well, but the default is wrong for
 * a data-entry tool and right for a dashboard, and this is not a dashboard.
 *
 * `retry: 1` because three retries with backoff means a dead API takes fifteen
 * seconds to admit it is dead, on a blank screen.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('Elementul #root lipseste din index.html')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Notificari>
        <App />
      </Notificari>
    </QueryClientProvider>
  </StrictMode>,
)
