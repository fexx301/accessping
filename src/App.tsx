import { useState, type FormEvent } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import './App.css'

type RequirementStatus =
  | 'confirmed_web'
  | 'confirmed_venue'
  | 'unknown'
  | 'conflicting'

const statusCopy: Record<RequirementStatus, string> = {
  confirmed_web: 'Confirmed by source',
  confirmed_venue: 'Confirmed by venue',
  unknown: 'Unknown',
  conflicting: 'Conflicting information',
}

function App() {
  const [url, setUrl] = useState('')
  const [caseId, setCaseId] = useState<Id<'cases'> | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const createCase = useMutation(api.cases.create)
  const analyzeVenue = useAction(api.research.analyzeVenue)
  const bundle = useQuery(api.cases.getBundle, caseId ? { caseId } : 'skip')

  const requirements = bundle?.requirements ?? []
  const unknownCount = requirements.filter((item) => item.status === 'unknown').length

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextUrl = url.trim()
    if (!nextUrl || isStarting) return

    setSubmitError(null)
    setIsStarting(true)

    try {
      const nextCaseId = await createCase({ url: nextUrl })
      setCaseId(nextCaseId)

      void analyzeVenue({ caseId: nextCaseId, url: nextUrl }).catch((error: unknown) => {
        console.error('Venue analysis failed', error)
      })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not start the access check.')
    } finally {
      setIsStarting(false)
    }
  }

  const caseStatus = bundle?.case.status
  const statusHeadline = !bundle
    ? 'No venue analyzed yet'
    : caseStatus === 'queued'
      ? 'Queued for research'
      : caseStatus === 'researching'
        ? 'Researching source evidence…'
        : caseStatus === 'ready'
          ? bundle.case.venueName || 'Access check ready'
          : 'Research failed'

  return (
    <main className="shell">
      <nav className="nav">
        <a className="brand" href="#top" aria-label="AccessPing home">
          <span className="brand-mark" aria-hidden="true">AP</span>
          <span>AccessPing</span>
        </a>
        <span className="build-badge">Hackathon build</span>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow">Know before you go</div>
        <h1>Turn missing accessibility details into answers.</h1>
        <p className="hero-copy">
          Paste a venue or event page. AccessPing finds what is actually confirmed,
          leaves unsupported claims unknown, and can ask the venue for the rest.
        </p>

        <form className="url-form" onSubmit={handleSubmit}>
          <label htmlFor="venue-url">Venue or event URL</label>
          <div className="url-row">
            <input
              id="venue-url"
              type="url"
              placeholder="https://example.com/event"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
            <button type="submit" disabled={isStarting}>
              {isStarting ? 'Starting…' : 'Check access'}
            </button>
          </div>
          <p className="form-note">
            No accessibility claim is marked confirmed without source evidence.
          </p>
          {submitError && <p className="error-message">{submitError}</p>}
        </form>
      </section>

      <section className="workspace" aria-live="polite">
        <div className="workspace-header">
          <div>
            <p className="section-kicker">Access checklist</p>
            <h2>{statusHeadline}</h2>
            <p className="workspace-copy">
              {bundle?.case.url ?? 'Your source-backed results will appear here after the first analysis.'}
            </p>
            {bundle?.case.error && <p className="error-message">{bundle.case.error}</p>}
          </div>
          {bundle && <div className="unknown-pill">{unknownCount} unknown</div>}
        </div>

        <div className="requirements-grid">
          {requirements.length === 0 ? (
            <div className="empty-state">
              <p>Paste a venue or event URL to create the first six-field access check.</p>
            </div>
          ) : (
            requirements.map((item) => (
              <article className="requirement-card" key={item._id}>
                <div className={`status-dot status-${item.status}`} aria-hidden="true" />
                <div>
                  <h3>{item.label}</h3>
                  <p className={`status-label status-text-${item.status}`}>
                    {statusCopy[item.status]}
                  </p>
                  {item.answer && <p className="answer">{item.answer}</p>}
                  {item.evidence && <p className="evidence">“{item.evidence}”</p>}
                  {item.sourceUrl && (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                      View source
                    </a>
                  )}
                </div>
              </article>
            ))
          )}
        </div>

        <div className="outreach-panel">
          <div>
            <p className="section-kicker">Next step</p>
            <h2>Ask only what the web could not answer.</h2>
            <p>
              After the research spike passes, the next vertical slice drafts one targeted
              AgentMail message from the remaining unknown fields and requires approval before sending.
            </p>
          </div>
          <button type="button" disabled={caseStatus !== 'ready' || unknownCount === 0}>
            Ask venue
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
