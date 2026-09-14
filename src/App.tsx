import { useRef, useState, type FormEvent } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import './App.css'

type RequirementStatus =
  | 'confirmed_web'
  | 'confirmed_venue'
  | 'unknown'
  | 'conflicting'

type NeedOption = {
  key: string
  label: string
}

type DisplayRequirement = {
  _id: string
  key: string
  label: string
  status: RequirementStatus
  isPriority?: boolean
  answer?: string
  evidence?: string
  sourceUrl?: string
}

const needOptions: NeedOption[] = [
  { key: 'step_free_entrance', label: 'Step-free entrance' },
  { key: 'accessible_toilet', label: 'Accessible toilet' },
  { key: 'accessible_seating', label: 'Accessible seating' },
  { key: 'parking_dropoff', label: 'Parking / drop-off' },
  { key: 'hearing_support', label: 'Hearing / communication support' },
  { key: 'quiet_space', label: 'Quiet / sensory space' },
]

const statusCopy: Record<RequirementStatus, string> = {
  confirmed_web: 'Source confirmed',
  confirmed_venue: 'Venue confirmed',
  unknown: 'Unverified',
  conflicting: 'Conflicting sources',
}

const previewRequirements: DisplayRequirement[] = [
  {
    _id: 'preview-step-free',
    key: 'step_free_entrance',
    label: 'Step-free entrance',
    status: 'confirmed_web',
    answer: 'A step-free entrance is listed at the west entrance.',
    evidence: 'Visitors who require step-free access should use the west entrance.',
    sourceUrl: 'https://example.com/accessibility',
  },
  {
    _id: 'preview-toilet',
    key: 'accessible_toilet',
    label: 'Accessible toilet',
    status: 'confirmed_web',
    answer: 'An accessible toilet is listed on the ground floor.',
    evidence: 'Accessible toilets are available on the ground floor beside the main concourse.',
    sourceUrl: 'https://example.com/accessibility',
  },
  {
    _id: 'preview-seating',
    key: 'accessible_seating',
    label: 'Accessible seating',
    status: 'unknown',
  },
  {
    _id: 'preview-parking',
    key: 'parking_dropoff',
    label: 'Parking / drop-off',
    status: 'conflicting',
    answer: 'The published parking guidance is inconsistent.',
    evidence: 'One page lists accessible parking on site; another says accessible parking must be arranged in advance.',
    sourceUrl: 'https://example.com/accessibility',
  },
  {
    _id: 'preview-hearing',
    key: 'hearing_support',
    label: 'Hearing / communication support',
    status: 'unknown',
  },
  {
    _id: 'preview-quiet',
    key: 'quiet_space',
    label: 'Quiet / sensory space',
    status: 'confirmed_venue',
    answer: 'The venue reply confirms a quiet room can be made available on request.',
    evidence: 'Yes — we can make the quiet room beside reception available during the event.',
  },
]

function sourceDomain(sourceUrl?: string) {
  if (!sourceUrl) return null
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return 'source'
  }
}

function App() {
  const previewMode = new URLSearchParams(window.location.search).get('preview') === '1'
  const [url, setUrl] = useState(previewMode ? 'https://example.com/accessibility' : '')
  const [urlTouched, setUrlTouched] = useState(false)
  const [selectedNeeds, setSelectedNeeds] = useState<string[]>(
    previewMode ? ['accessible_seating', 'hearing_support'] : [],
  )
  const [caseId, setCaseId] = useState<Id<'cases'> | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(previewMode)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const reportStatusRef = useRef<HTMLDivElement>(null)

  const createCase = useMutation(api.cases.create)
  const setPriority = useMutation(api.cases.setPriority)
  const analyzeVenue = useAction(api.research.analyzeVenue)
  const sendInquiry = useAction(api.outreach.sendInquiry)
  const bundle = useQuery(api.cases.getBundle, caseId ? { caseId } : 'skip')

  const requirements: DisplayRequirement[] = previewMode
    ? previewRequirements
    : (bundle?.requirements ?? []).map((item) => ({ ...item, _id: item._id as string }))
  const confirmedCount = requirements.filter(
    (item) => item.status === 'confirmed_web' || item.status === 'confirmed_venue',
  ).length
  const conflictingCount = requirements.filter((item) => item.status === 'conflicting').length
  const unknownCount = requirements.filter((item) => item.status === 'unknown').length
  const priorityUnknowns = requirements.filter(
    (item) => item.status === 'unknown' && selectedNeeds.includes(item.key),
  )

  const normalizedUrl = url.trim()
  let urlIsValid = false
  try {
    const parsed = new URL(normalizedUrl)
    urlIsValid = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    urlIsValid = false
  }

  const urlError = !urlTouched
    ? null
    : normalizedUrl.length === 0
      ? 'Add a venue or event URL to start.'
      : !urlIsValid
        ? 'Use a complete http:// or https:// venue or event URL.'
        : null

  function toggleNeed(key: string) {
    const nextIsPriority = !selectedNeeds.includes(key)

    setSelectedNeeds((current) =>
      nextIsPriority ? [...current, key] : current.filter((item) => item !== key),
    )

    if (caseId && !previewMode) {
      void setPriority({ caseId, key, isPriority: nextIsPriority }).catch((error: unknown) => {
        console.error('Could not save priority', error)
        setSelectedNeeds((current) =>
          nextIsPriority ? current.filter((item) => item !== key) : [...current, key],
        )
      })
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (previewMode) return
    setUrlTouched(true)

    if (!urlIsValid || isStarting) return

    setSubmitError(null)
    setQuestionsOpen(false)
    setIsStarting(true)

    try {
      const nextCaseId = await createCase({ url: normalizedUrl, priorityKeys: selectedNeeds })
      setCaseId(nextCaseId)

      requestAnimationFrame(() => {
        reportStatusRef.current?.focus({ preventScroll: true })
        reportStatusRef.current?.scrollIntoView({ block: 'start' })
      })

      void analyzeVenue({ caseId: nextCaseId, url: normalizedUrl }).catch((error: unknown) => {
        console.error('Venue analysis failed', error)
      })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not start the access check.')
    } finally {
      setIsStarting(false)
    }
  }

  async function handleSendInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!caseId || previewMode || isSending) return

    setSendError(null)
    setIsSending(true)
    try {
      await sendInquiry({ caseId, recipient: recipientEmail.trim() })
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not send the venue questions.')
    } finally {
      setIsSending(false)
    }
  }

  const caseStatus = previewMode ? 'ready' : bundle?.case.status
  const statusHeadline = previewMode
    ? 'Synthetic venue preview'
    : !bundle
    ? 'Ready for a venue'
    : caseStatus === 'queued'
      ? 'Research queued'
      : caseStatus === 'researching'
        ? 'Reading the venue source'
        : caseStatus === 'ready'
          ? bundle.case.venueName || 'Source review complete'
          : 'Research stopped'

  const statusDetail = previewMode
    ? `${confirmedCount} confirmed · ${unknownCount} unverified · ${conflictingCount} conflicting · UI preview only`
    : !bundle
    ? 'Add a venue or event URL. The ledger below shows exactly what AccessPing will verify.'
    : caseStatus === 'queued'
      ? 'The case is in Convex and waiting for the research action to begin.'
      : caseStatus === 'researching'
        ? 'Firecrawl is collecting the source and OpenAI is separating explicit evidence from missing information.'
        : caseStatus === 'ready'
          ? `${confirmedCount} confirmed · ${unknownCount} unverified · ${conflictingCount} conflicting`
          : bundle.case.error || 'The source could not be reviewed. Try the venue URL again.'

  const ledgerNote = previewMode
    ? 'Synthetic state for visual QA only. These rows are not a live venue check and are not submission evidence.'
    : !bundle
    ? 'All six details will be researched. Mark any that matter most so venue follow-up stays focused.'
    : caseStatus === 'queued'
      ? 'All six details are queued for review. Current priorities shape the follow-up view.'
      : caseStatus === 'researching'
        ? 'All six details are being checked against the source. Unsupported claims will remain unverified.'
        : caseStatus === 'ready'
          ? 'All six details were reviewed. Priorities shape only the follow-up, never the evidence itself.'
          : 'Research stopped before the ledger could be completed.'

  const caseSource = previewMode ? 'example.com' : bundle ? sourceDomain(bundle.case.url) : null
  const caseTime = previewMode
    ? 'Synthetic'
    : bundle
    ? new Date(bundle.case.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  const outreachStatus = previewMode ? null : bundle?.outreach?.status
  const outreachLocked =
    outreachStatus === 'pending' || outreachStatus === 'sent' || outreachStatus === 'replied'

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AccessPing home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>AccessPing</span>
        </a>
        <p className="product-note">Evidence-first venue accessibility checks</p>
      </header>

      <div className="workbench" id="top">
        <aside className="control-rail" aria-label="Set up an access check">
          <div className="control-rail__intro">
            <h1>Know what the venue actually confirms.</h1>
            <p>
              AccessPing checks six practical access details against the source, keeps missing
              information unverified, and prepares only the questions still worth asking.
            </p>
          </div>

          <form className="venue-form" onSubmit={handleSubmit} noValidate>
            <div className="url-field">
              <label htmlFor="venue-url">Venue or event URL</label>
              <input
                id="venue-url"
                type="url"
                inputMode="url"
                placeholder="https://venue.example/event"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onBlur={() => setUrlTouched(true)}
                aria-invalid={urlError ? 'true' : 'false'}
                aria-describedby="venue-url-help"
                disabled={previewMode}
                required
              />
              <p className="form-helper" id="venue-url-help">
                {previewMode
                  ? 'Synthetic preview only. Live venue checks are disabled on this QA route.'
                  : urlError ?? 'Published evidence stays separate from assumptions.'}
              </p>
            </div>

            <button
              className="primary-action"
              type="submit"
              disabled={isStarting || previewMode}
            >
              {previewMode ? 'Preview only' : isStarting ? 'Starting research…' : 'Check this venue'}
            </button>
            {submitError && <p className="error-message">{submitError}</p>}
          </form>

          <div className="trust-note">
            <span className="trust-note__mark" aria-hidden="true">↳</span>
            <p>If a source does not say it, AccessPing leaves it unverified instead of guessing.</p>
          </div>
        </aside>

        <section className="report-panel" aria-labelledby="report-title">
          <header className="report-head">
            <div className="report-head__copy">
              {previewMode && (
                <p className="preview-banner">Synthetic UI preview · not a live venue check</p>
              )}
              <p className="report-label">Access ledger</p>
              <h2 id="report-title">{statusHeadline}</h2>
              <div
                className="report-status"
                ref={reportStatusRef}
                tabIndex={-1}
                aria-live="polite"
                aria-atomic="true"
              >
                <p>{statusDetail}</p>
              </div>
              {previewMode ? (
                <p className="report-url">https://example.com/accessibility</p>
              ) : bundle?.case.url ? (
                <p className="report-url">{bundle.case.url}</p>
              ) : null}
            </div>

            {(bundle || previewMode) && (
              <dl className="case-meta" aria-label="Case state">
                <div>
                  <dt>State</dt>
                  <dd>{previewMode ? 'UI preview' : caseStatus === 'queued' ? 'Queued' : caseStatus === 'researching' ? 'Researching' : caseStatus === 'ready' ? 'Reviewed' : 'Stopped'}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{caseSource}</dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>{selectedNeeds.length === 0 ? 'None selected' : `${selectedNeeds.length} selected`}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{caseTime}</dd>
                </div>
              </dl>
            )}
          </header>

          <div className="ledger-note">
            <p>{ledgerNote}</p>
          </div>

          <div className="ledger-head" aria-hidden="true">
            <span>Access detail</span>
            <span>Evidence state</span>
            <span>Source</span>
          </div>

          <div className="report-body">
            {requirements.length === 0 ? (
              <ul className="requirement-list requirement-list--idle">
                {needOptions.map((option) => {
                  const selected = selectedNeeds.includes(option.key)
                  return (
                    <li className="requirement-row" key={option.key}>
                      <div className="requirement-row__detail">
                        <div className="requirement-row__name">
                          <h3>{option.label}</h3>
                          <label className={`priority-toggle ${selected ? 'is-selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleNeed(option.key)}
                              aria-label={`Prioritise ${option.label}`}
                            />
                            <span className="priority-toggle__mark" aria-hidden="true">{selected ? '✓' : '+'}</span>
                            <span>{selected ? 'Priority' : 'Mark priority'}</span>
                          </label>
                        </div>
                      </div>
                      <div className="requirement-row__state">
                        <span className="status-dot status-dot--idle" aria-hidden="true" />
                        <span>Waiting for source</span>
                      </div>
                      <div className="requirement-row__source requirement-row__source--empty">—</div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <ul className="requirement-list">
                {requirements.map((item) => {
                    const selected = selectedNeeds.includes(item.key)
                    const domain = sourceDomain(item.sourceUrl)
                    return (
                      <li className="requirement-row" key={item._id}>
                        <div className="requirement-row__detail">
                          <div className="requirement-row__name">
                            <h3>{item.label}</h3>
                            <label className={`priority-toggle ${selected ? 'is-selected' : ''}`}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleNeed(item.key)}
                                aria-label={`Prioritise ${item.label}`}
                              />
                              <span className="priority-toggle__mark" aria-hidden="true">{selected ? '✓' : '+'}</span>
                              <span>{selected ? 'Priority' : 'Mark priority'}</span>
                            </label>
                          </div>
                          {item.answer ? (
                            <p className="answer">{item.answer}</p>
                          ) : (
                            <p className="requirement-row__note">
                              {caseStatus === 'researching'
                                ? 'Checking the source…'
                                : caseStatus === 'failed'
                                  ? 'Not reviewed because research stopped.'
                                  : 'No supported answer found in the source.'}
                            </p>
                          )}
                          {item.evidence && (
                            <div className="evidence">
                              <p className="evidence__label">
                                {item.status === 'confirmed_venue' ? 'Venue reply evidence' : 'Source evidence'}
                                {domain ? ` · ${domain}` : ''}
                              </p>
                              <blockquote><p>{item.evidence}</p></blockquote>
                            </div>
                          )}
                        </div>

                        <div className={`requirement-row__state state-${item.status}`}>
                          <span className={`status-dot status-dot--${item.status}`} aria-hidden="true" />
                          <span>{statusCopy[item.status]}</span>
                        </div>

                        <div className="requirement-row__source">
                          {item.sourceUrl ? (
                            <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                              <span>{domain}</span>
                              <span aria-hidden="true">↗</span>
                            </a>
                          ) : item.status === 'confirmed_venue' ? (
                            <span className="source-empty">Venue reply</span>
                          ) : (
                            <span className="source-empty">No source</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
              </ul>
            )}
          </div>

          {caseStatus === 'ready' && unknownCount > 0 && (
            <aside className="followup" aria-label="Venue follow-up">
              <div>
                <h3>
                  {priorityUnknowns.length > 0
                    ? `${priorityUnknowns.length} prioritised question${priorityUnknowns.length === 1 ? '' : 's'} · ${unknownCount} unverified total`
                    : `${unknownCount} unverified detail${unknownCount === 1 ? '' : 's'} still worth asking`}
                </h3>
                <p>
                  AccessPing can turn the remaining unverified details into one focused venue message.
                </p>
              </div>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setQuestionsOpen((open) => !open)}
                aria-expanded={questionsOpen}
              >
                {questionsOpen ? 'Hide questions' : 'Review questions'}
              </button>

              {questionsOpen && (
                <div className="question-preview">
                  <p className="question-preview__label">Draft question set</p>
                  <ul>
                    {(priorityUnknowns.length > 0
                      ? priorityUnknowns
                      : requirements.filter((item) => item.status === 'unknown')
                    ).map((item) => <li key={item._id}>{item.label}</li>)}
                  </ul>
                  <p className="question-preview__note">
                    Review only. Nothing is sent until you enter the venue email and press Send questions.
                  </p>

                  {!previewMode && (
                    <form className="outreach-form" onSubmit={handleSendInquiry}>
                      <label htmlFor="venue-email">Venue email</label>
                      <input
                        id="venue-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="access@venue.example"
                        value={recipientEmail}
                        onChange={(event) => setRecipientEmail(event.target.value)}
                        disabled={isSending || outreachLocked}
                        required
                      />
                      <button
                        className="secondary-action outreach-send"
                        type="submit"
                        disabled={isSending || outreachLocked || recipientEmail.trim().length === 0}
                      >
                        {isSending
                          ? 'Sending…'
                          : outreachStatus === 'replied'
                            ? 'Venue replied'
                            : outreachLocked
                              ? 'Questions sent'
                              : 'Send questions'}
                      </button>

                      {sendError && <p className="outreach-message outreach-message--error">{sendError}</p>}
                      {bundle?.outreach && !sendError && (
                        <p className={`outreach-message outreach-message--${bundle.outreach.status}`}>
                          {bundle.outreach.status === 'replied'
                            ? 'Venue reply received. Any explicitly answered details update in the ledger above.'
                            : bundle.outreach.status === 'failed'
                              ? 'Delivery failed. Check the address and try again.'
                              : `Sent to ${bundle.outreach.recipient}. Waiting for the venue reply.`}
                        </p>
                      )}
                    </form>
                  )}
                </div>
              )}
            </aside>
          )}

          {caseStatus === 'ready' && unknownCount === 0 && (
            <div className="completion-note">All six access details have supporting answers in this case.</div>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
