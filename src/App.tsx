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
  confirmed_web: 'Source confirmed',
  confirmed_venue: 'Venue confirmed',
  unknown: 'Not verified',
  conflicting: 'Conflicting sources',
}

const statusGlyph: Record<RequirementStatus, string> = {
  confirmed_web: '✓',
  confirmed_venue: '✓',
  unknown: '—',
  conflicting: '!',
}

function App() {
  const [url, setUrl] = useState('')
  const [urlTouched, setUrlTouched] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [caseId, setCaseId] = useState<Id<'cases'> | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const createCase = useMutation(api.cases.create)
  const analyzeVenue = useAction(api.research.analyzeVenue)
  const bundle = useQuery(api.cases.getBundle, caseId ? { caseId } : 'skip')

  const requirements = bundle?.requirements ?? []
  const unknownCount = requirements.filter((item) => item.status === 'unknown').length
  const confirmedCount = requirements.filter(
    (item) => item.status === 'confirmed_web' || item.status === 'confirmed_venue',
  ).length
  const conflictingCount = requirements.filter((item) => item.status === 'conflicting').length

  function validateVenueUrl(value: string) {
    if (!value.trim()) return 'Add a venue or event URL to continue.'

    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Use a full http:// or https:// URL.'
      }
      return null
    } catch {
      return 'Enter a complete URL, for example https://venue.example/event.'
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextUrl = url.trim()
    const nextUrlError = validateVenueUrl(nextUrl)
    setUrlTouched(true)
    setUrlError(nextUrlError)
    if (nextUrlError || isStarting) return

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
    <main className="app-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AccessPing home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>AccessPing</span>
        </a>
        <p className="product-note">Evidence-first venue accessibility checks</p>
      </header>

      <div className="workbench">
        <aside className="control-rail" aria-label="Start an accessibility check">
          <div className="control-rail__intro">
            <h1>Know what is confirmed before you arrive.</h1>
            <p>
              Paste a venue or event page. AccessPing separates published evidence from missing
              information, then prepares the unanswered questions for the venue.
            </p>
          </div>

          <form className="venue-form" onSubmit={handleSubmit} noValidate>
            <label htmlFor="venue-url">Venue or event URL</label>
            <input
              id="venue-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://venue.example/event"
              value={url}
              onChange={(event) => {
                const nextValue = event.target.value
                setUrl(nextValue)
                if (urlTouched) setUrlError(validateVenueUrl(nextValue))
                if (submitError) setSubmitError(null)
              }}
              onBlur={() => {
                setUrlTouched(true)
                setUrlError(validateVenueUrl(url))
              }}
              aria-describedby="venue-url-help"
              aria-invalid={urlError || submitError ? true : undefined}
              aria-required="true"
              required
            />
            <div className="form-helper" id="venue-url-help">
              {urlError ?? submitError ?? 'Published evidence is kept separate from assumptions.'}
            </div>
            <button className="primary-action" type="submit" disabled={isStarting}>
              {isStarting ? 'Checking…' : 'Check this venue'}
            </button>
          </form>

          <div className="trust-note">
            <span className="trust-note__mark" aria-hidden="true">↳</span>
            <p>
              If a source does not say it, AccessPing leaves it unverified instead of guessing.
            </p>
          </div>
        </aside>

        <section className="report-panel" aria-live="polite" aria-busy={caseStatus === 'researching'}>
          <header className="report-head">
            <div className="report-head__copy">
              <p className="report-label">Access report</p>
              <h2>{statusHeadline}</h2>
              <p className="report-url">
                {bundle?.case.url ?? 'Run a check to build a source-backed accessibility report.'}
              </p>
              {bundle?.case.error && <p className="error-message">{bundle.case.error}</p>}
            </div>

            {bundle ? (
              <dl className="report-summary" aria-label="Report summary">
                <div>
                  <dt>Confirmed</dt>
                  <dd>{confirmedCount}</dd>
                </div>
                <div>
                  <dt>Unverified</dt>
                  <dd>{unknownCount}</dd>
                </div>
                <div>
                  <dt>Conflicts</dt>
                  <dd>{conflictingCount}</dd>
                </div>
              </dl>
            ) : null}
          </header>

          <div className="report-body">
            {requirements.length === 0 ? (
              <div className="empty-report">
                <div className="empty-report__index" aria-hidden="true">01</div>
                <div>
                  <h3>No report yet</h3>
                  <p>
                    Add a venue URL. The first pass checks six practical access details and keeps a
                    source trail for anything marked confirmed.
                  </p>
                </div>
              </div>
            ) : (
              <ol className="requirement-list">
                {requirements.map((item, index) => (
                  <li className="requirement-row" key={item._id}>
                    <div className="requirement-row__index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="requirement-row__main">
                      <div className="requirement-row__titleline">
                        <h3>{item.label}</h3>
                        <span className={`status-chip status-chip--${item.status}`}>
                          <span aria-hidden="true">{statusGlyph[item.status]}</span>
                          {statusCopy[item.status]}
                        </span>
                      </div>
                      {item.answer && <p className="answer">{item.answer}</p>}
                      {item.evidence && (
                        <blockquote className="evidence">
                          <p>{item.evidence}</p>
                        </blockquote>
                      )}
                    </div>
                    <div className="requirement-row__source">
                      {item.sourceUrl ? (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                          Open source ↗
                        </a>
                      ) : (
                        <span>No source yet</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <footer className="report-action">
            <div>
              <h3>Still missing something?</h3>
              <p>
                The next step will draft one focused message containing only the details the web
                could not verify.
              </p>
            </div>
            <div className="report-action__controls">
              <button
                className="secondary-action"
                type="button"
                disabled={caseStatus !== 'ready' || unknownCount === 0}
                aria-describedby="ask-venue-state"
              >
                Ask venue
              </button>
              <span id="ask-venue-state" className="action-hint">
                {caseStatus !== 'ready'
                  ? 'Available after research'
                  : unknownCount === 0
                    ? 'Nothing left to ask'
                    : `${unknownCount} item${unknownCount === 1 ? '' : 's'} to verify`}
              </span>
            </div>
          </footer>
        </section>
      </div>
    </main>
  )
}

export default App
