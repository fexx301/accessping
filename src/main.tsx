import { StrictMode, Component, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider, useAuthActions, useConvexAuth } from '@convex-dev/auth/react'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ maxWidth: '40rem', margin: '4rem auto', padding: '0 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
          <h1>AccessPing could not start</h1>
          <p>{this.state.error.message}</p>
          <p>Check that VITE_CONVEX_URL is configured, then reload.</p>
        </main>
      )
    }
    return this.props.children
  }
}

// Anonymous Convex Auth session: zero-friction sign-in so every case is
// owned by an authenticated user id in addition to the browser token.
function EnsureSignedIn() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { signIn } = useAuthActions()
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      void signIn('anonymous').catch((error: unknown) => {
        console.error('Anonymous sign-in failed', error)
      })
    }
  }, [isLoading, isAuthenticated, signIn])
  return null
}

function start() {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('Missing #root element.')

  const convexUrl = import.meta.env.VITE_CONVEX_URL
  if (!convexUrl) {
    createRoot(rootEl).render(
      <StrictMode>
        <ErrorBoundary>
          <main style={{ maxWidth: '40rem', margin: '4rem auto', padding: '0 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
            <h1>AccessPing is not configured</h1>
            <p>VITE_CONVEX_URL is missing. Run `npx convex dev` to configure the project, then reload.</p>
          </main>
        </ErrorBoundary>
      </StrictMode>,
    )
    return
  }

  const convex = new ConvexReactClient(convexUrl)
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <ConvexAuthProvider client={convex}>
          <EnsureSignedIn />
          <App />
        </ConvexAuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

start()
