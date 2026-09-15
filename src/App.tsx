import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useConvexAuth } from '@convex-dev/auth/react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { isValidEmail, MAX_SENDS_PER_CASE } from '../convex/guards'
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

type OwnedCaseRef = { caseId: Id<'cases'>; ownerToken: string }

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
  conflicting: 'Conflicting evidence',
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

const TOKENS_KEY = 'accessping:tokens:v1'
const HISTORY_KEY = 'accessping:history:v1'

function sourceLabel(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    const label = `${parsed.hostname.replace(/^www\./, '')}${path}`
    return label.length > 48 ? `${label.slice(0, 47)}…` : label
  } catch {
    return sourceUrl
  }
}

function sourceDomain(sourceUrl?: string) {
  if (!sourceUrl) return null
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return 'source'
  }
}

function readTokenMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function writeTokenMap(map: Record<string, string>) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(map))
  } catch {
    // Storage may be unavailable (private mode); ownership still works in-memory.
  }
}

function readHistoryOrder(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeHistoryOrder(order: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(order.slice(0, 20)))
  } catch {
    // ignore
  }
}

function newOwnerToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

function buildMarkdown(
  venueName: string | undefined,
  url: string | undefined,
  requirements: DisplayRequirement[],
): string {
  const lines = [
    `# AccessPing checklist${venueName ? ` — ${venueName}` : ''}`,
    url ? `Source: ${url}` : null,
    '',
    ...requirements.map((r) => {
      const state = statusCopy[r.status]
      const parts = [`## ${r.label} — ${state}`]
      if (r.answer) parts.push('', r.answer)
      if (r.evidence) parts.push('', `Evidence: ${r.evidence}`)
      if (r.sourceUrl) parts.push('', `Source: ${r.sourceUrl}`)
      return parts.join('\n')
    }),
    '',
    'Unverified means the source did not state it — not that it is unavailable.',
  ]
  return lines.filter((l) => l !== null).join('\n')
}

function BrandMark({ className = 'brand-icon' }: { className?: string }) {
  return (
    <svg className={className} viewBox="30 10 196 184" aria-hidden="true" focusable="false">
      <path
        d="M62 172 C72 118, 112 58, 142 40 C152 34, 160 42, 156 54 C152 68, 138 78, 122 86 C110 92, 100 100, 96 112"
        fill="none"
        stroke="currentColor"
        strokeWidth="34"
        strokeLinecap="round"
      />
      <path
        d="M98 148 C128 136, 160 146, 180 170 C182 174, 180 179, 175 179 C152 168, 124 164, 102 170 C96 172, 93 164, 94 156 C94 152, 96 149, 98 148 Z"
        fill="currentColor"
      />
      <circle cx="174" cy="80" r="14" fill="var(--color-accent)" />
      <path
        d="M197 61 A30 30 0 0 1 197 99"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M211 49 A48 48 0 0 1 211 111"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="13"
        strokeLinecap="round"
      />
    </svg>
  )
}

function App() {
  const searchParams = new URLSearchParams(window.location.search)
  const previewMode = searchParams.get('preview') === '1'
  const deepLinkedCase = searchParams.get('case') as Id<'cases'> | null
  const sharedToken = searchParams.get('share')
  const { isAuthenticated } = useConvexAuth()

  const [url, setUrl] = useState(previewMode ? 'https://example.com/accessibility' : '')
  const [urlTouched, setUrlTouched] = useState(false)
  const [selectedNeeds, setSelectedNeeds] = useState<string[]>(
    previewMode ? ['accessible_seating', 'hearing_support'] : [],
  )
  const [caseId, setCaseId] = useState<Id<'cases'> | null>(deepLinkedCase)
  const [ownerTokens, setOwnerTokens] = useState<Record<string, string>>(() => readTokenMap())
  const [historyOrder, setHistoryOrder] = useState<string[]>(() => readHistoryOrder())
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(previewMode)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const reportStatusRef = useRef<HTMLDivElement>(null)
  const hydratedCaseRef = useRef<string | null>(null)

  const createCase = useMutation(api.cases.create)
  const setPriority = useMutation(api.cases.setPriority)
  const resetForRetry = useMutation(api.cases.resetForRetry)
  const removeCase = useMutation(api.cases.remove)
  const ensureShareToken = useMutation(api.cases.ensureShareToken)
  const analyzeVenue = useAction(api.research.analyzeVenue)
  const sendInquiry = useAction(api.outreach.sendInquiry)
  const syncLatestReply = useAction(api.outreach.syncLatestReply)

  const ownerToken = caseId ? ownerTokens[caseId] : undefined
  const bundle = useQuery(
    api.cases.getBundle,
    caseId ? { caseId, ownerToken } : 'skip',
  )
  const screenshotUrl = useQuery(
    api.cases.getScreenshotUrl,
    caseId && bundle?.case.screenshotId ? { caseId, ownerToken } : 'skip',
  )
  const historyRefs: OwnedCaseRef[] = historyOrder
    .map((id) => ({ caseId: id as Id<'cases'>, ownerToken: ownerTokens[id] }))
    .filter((r) => r.ownerToken)
    .slice(0, 10)
  const history = useQuery(
    api.cases.getHistory,
    previewMode || historyRefs.length === 0 ? 'skip' : { refs: historyRefs },
  )

  // Hydrate priority selection from the stored case exactly once per case.
  useEffect(() => {
    if (previewMode || !bundle || !caseId) return
    if (hydratedCaseRef.current === caseId) return
    hydratedCaseRef.current = caseId
    const stored = bundle.requirements.filter((r) => r.isPriority).map((r) => r.key)
    setSelectedNeeds(stored)
  }, [bundle, caseId, previewMode])

  // Transient confirmations (clipboard copies, background reply checks)
  // surface as fixed toasts that never shift the ledger layout.
  useEffect(() => {
    if (!shareMessage && !syncMessage) return
    const timer = window.setTimeout(() => {
      setShareMessage(null)
      setSyncMessage(null)
    }, 6000)
    return () => window.clearTimeout(timer)
  }, [shareMessage, syncMessage])

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

  const trimmedEmail = ownerEmail.trim()
  const emailError =
    !emailTouched || trimmedEmail.length === 0
      ? null
      : !isValidEmail(trimmedEmail)
        ? 'Enter a valid email for updates, or leave it blank.'
        : null

  function persistOwnership(nextCaseId: Id<'cases'>, token: string) {
    const nextTokens = { ...readTokenMap(), [nextCaseId]: token }
    writeTokenMap(nextTokens)
    setOwnerTokens(nextTokens)
    const nextOrder = [nextCaseId, ...readHistoryOrder().filter((id) => id !== nextCaseId)].slice(0, 20)
    writeHistoryOrder(nextOrder)
    setHistoryOrder(nextOrder)
  }

  function toggleNeed(key: string) {
    const nextIsPriority = !selectedNeeds.includes(key)

    setSelectedNeeds((current) =>
      nextIsPriority ? [...current, key] : current.filter((item) => item !== key),
    )

    if (caseId && !previewMode) {
      void setPriority({ caseId, key, isPriority: nextIsPriority, ownerToken }).catch(
        (error: unknown) => {
          console.error('Could not save priority', error)
          setSelectedNeeds((current) =>
            nextIsPriority ? current.filter((item) => item !== key) : [...current, key],
          )
        },
      )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (previewMode) return
    setUrlTouched(true)
    setEmailTouched(true)

    if (!urlIsValid || emailError || isStarting) return

    setSubmitError(null)
    setQuestionsOpen(false)
    setIsStarting(true)

    const token = newOwnerToken()
    try {
      const result = await createCase({
        url: normalizedUrl,
        priorityKeys: selectedNeeds,
        ownerToken: token,
        ownerEmail: trimmedEmail || undefined,
      })
      const nextCaseId = result.caseId
      persistOwnership(nextCaseId, token)
      setCaseId(nextCaseId)
      hydratedCaseRef.current = nextCaseId
      try {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('case', nextCaseId)
        window.history.replaceState(null, '', nextUrl.toString())
      } catch {
        // Non-fatal: deep link just won't update.
      }

      requestAnimationFrame(() => {
        reportStatusRef.current?.focus({ preventScroll: true })
        reportStatusRef.current?.scrollIntoView({ block: 'start' })
      })

      void analyzeVenue({ caseId: nextCaseId, url: normalizedUrl, ownerToken: token }).catch(
        (error: unknown) => {
          console.error('Venue analysis failed', error)
        },
      )
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not start the access check.')
    } finally {
      setIsStarting(false)
    }
  }

  async function handleRetry() {
    if (!caseId || previewMode || isRetrying) return
    setSubmitError(null)
    setIsRetrying(true)
    try {
      await resetForRetry({ caseId, ownerToken })
      const researchUrl = bundle?.case.url ?? normalizedUrl
      await analyzeVenue({ caseId, url: researchUrl, ownerToken })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not retry the access check.')
    } finally {
      setIsRetrying(false)
    }
  }

  async function handleSendInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!caseId || previewMode || isSending) return

    setSendError(null)
    setIsSending(true)
    try {
      await sendInquiry({ caseId, recipient: recipientEmail.trim(), ownerToken })
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not send the venue questions.')
    } finally {
      setIsSending(false)
    }
  }

  async function handleSyncReply() {
    if (!caseId || previewMode || isSyncing) return
    setSyncMessage(null)
    setIsSyncing(true)
    try {
      const result = await syncLatestReply({ caseId })
      setSyncMessage(
        result.found
          ? 'Venue reply found and applied to the ledger above.'
          : 'No venue reply found yet. Replies apply automatically when they arrive.',
      )
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Could not check for a reply.')
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleDeleteHistory(target: Id<'cases'>) {
    setHistoryError(null)
    try {
      await removeCase({ caseId: target, ownerToken: ownerTokens[target] })
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not delete that check.')
      return
    }
    const nextTokens = { ...readTokenMap() }
    delete nextTokens[target]
    writeTokenMap(nextTokens)
    setOwnerTokens(nextTokens)
    const nextOrder = readHistoryOrder().filter((id) => id !== target)
    writeHistoryOrder(nextOrder)
    setHistoryOrder(nextOrder)
    if (caseId === target) {
      setCaseId(null)
      try {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete('case')
        window.history.replaceState(null, '', nextUrl.toString())
      } catch {
        // ignore
      }
    }
  }

  function openCase(target: Id<'cases'>) {
    setCaseId(target)
    hydratedCaseRef.current = null
    setSubmitError(null)
    setSendError(null)
    setSyncMessage(null)
    try {
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('case', target)
      window.history.replaceState(null, '', nextUrl.toString())
    } catch {
      // ignore
    }
    requestAnimationFrame(() => {
      reportStatusRef.current?.scrollIntoView({ block: 'start' })
    })
  }

  async function handleCopyLink() {
    setShareMessage(null)
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareMessage('Link copied. Anyone opening it on this browser can view the check.')
    } catch {
      setShareMessage('Copy failed — copy the address bar URL manually.')
    }
  }

  function handleCopySummary() {
    setShareMessage(null)
    const markdown = buildMarkdown(bundle?.case.venueName, bundle?.case.url, requirements)
    void navigator.clipboard
      .writeText(markdown)
      .then(() => setShareMessage('Checklist summary copied as markdown.'))
      .catch(() => setShareMessage('Copy failed — try Download instead.'))
  }

  function handleDownload() {
    const markdown = buildMarkdown(bundle?.case.venueName, bundle?.case.url, requirements)
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `accessping-${caseId ?? 'checklist'}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
  }

  async function handleShareLink() {
    if (!caseId || previewMode || isSharing) return
    setShareMessage(null)
    setIsSharing(true)
    try {
      const token = bundle?.case.shareToken ?? (await ensureShareToken({ caseId, ownerToken })).shareToken
      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${token}`
      await navigator.clipboard.writeText(shareUrl)
      setShareMessage('Share link copied. Anyone with the link can view this check read-only.')
    } catch {
      setShareMessage('Could not create the share link. Try again.')
    } finally {
      setIsSharing(false)
    }
  }

  const caseStatus = previewMode ? 'ready' : bundle?.case.status
  const ownershipBlocked = !previewMode && !!caseId && !!deepLinkedCase && caseId === deepLinkedCase && !ownerToken && bundle === null
  const statusHeadline = previewMode
    ? 'Synthetic venue preview'
    : ownershipBlocked
      ? 'Check unavailable here'
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
    : ownershipBlocked
      ? 'This check was created in another browser session and cannot be opened without its ownership token.'
      : !bundle
        ? 'Add a venue or event URL. The ledger below shows exactly what AccessPing will verify.'
        : caseStatus === 'queued'
          ? 'The case is in Convex and waiting for the research action to begin.'
          : caseStatus === 'researching'
            ? 'Checking the venue site and accessibility pages, then separating explicit evidence from missing information.'
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
  const outreachCount = previewMode ? 0 : (bundle?.outreachCount ?? 0)
  const sendsRemaining = Math.max(0, MAX_SENDS_PER_CASE - outreachCount)
  const canResend =
    !previewMode &&
    bundle &&
    caseStatus === 'ready' &&
    unknownCount > 0 &&
    (outreachStatus === 'failed' ||
      (outreachStatus === 'replied' && unknownCount > 0) ||
      (outreachStatus === undefined && false))
  const outreachLocked =
    outreachStatus === 'pending' ||
    outreachStatus === 'sent' ||
    (outreachStatus === 'replied' && !canResend)
  const showFollowup = caseStatus === 'ready' && unknownCount > 0 && !ownershipBlocked

  if (sharedToken && !previewMode) {
    return <SharedLedger shareToken={sharedToken} />
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#report-title">
        Skip to access ledger
      </a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AccessPing home">
          <BrandMark />
          <span className="brand-wordmark" aria-hidden="true">
            <span className="brand-wordmark__access">Access</span>
            <span className="brand-wordmark__ping">Ping</span>
          </span>
        </a>
        <p className="product-note">Evidence-first venue accessibility checks</p>
        <p
          className="auth-note"
          role="status"
          aria-live="polite"
          title="AccessPing signs you in anonymously so your checks are owned by your account."
        >
          {isAuthenticated ? 'Signed in' : 'Signing in…'}
        </p>
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

            <div className="url-field">
              <label htmlFor="owner-email">Email for updates (optional)</label>
              <input
                id="owner-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.org"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailError ? 'true' : 'false'}
                aria-describedby="owner-email-help"
                disabled={previewMode}
              />
              <p className="form-helper" id="owner-email-help">
                {previewMode
                  ? 'No emails are sent from the preview.'
                  : (emailError ??
                    'Get emailed when the review lands, a venue replies, or a weekly re-check finds changes.')}
              </p>
            </div>

            <button
              className="primary-action"
              type="submit"
              disabled={isStarting || previewMode}
            >
              {previewMode ? 'Preview only' : isStarting ? 'Starting research…' : 'Check this venue'}
            </button>
            {submitError && (
              <p className="error-message" role="alert">
                {submitError}
              </p>
            )}
          </form>

          {!previewMode && historyOrder.length > 0 && (
            <section className="history" aria-label="Recent checks">
              <h2>Recent checks</h2>
              {historyError && (
                <p className="error-message" role="alert">
                  {historyError}
                </p>
              )}
              {!history ? (
                <p className="history-empty">Loading recent checks…</p>
              ) : history.length === 0 ? (
                <p className="history-empty">No saved checks on this browser yet.</p>
              ) : (
                <ul>
                  {history.map((item) => (
                    <li key={item.caseId} className={item.caseId === caseId ? 'is-active' : ''}>
                      <button type="button" onClick={() => openCase(item.caseId as Id<'cases'>)}>
                        <span className="history-title">{item.venueName || item.url}</span>
                        <span className="history-meta">
                          {item.status} · {item.confirmed} confirmed · {item.unknown} unverified
                        </span>
                      </button>
                      <button
                        type="button"
                        className="history-delete"
                        onClick={() => void handleDeleteHistory(item.caseId as Id<'cases'>)}
                        aria-label={`Delete check for ${item.venueName || item.url}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <div className="trust-note">
            <span className="trust-note__mark" aria-hidden="true">↳</span>
            <p>If a source does not say it, AccessPing leaves it unverified instead of guessing.</p>
          </div>
        </aside>

        <section
          className="report-panel"
          aria-labelledby="report-title"
          aria-busy={caseStatus === 'researching' || caseStatus === 'queued'}
        >
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
              {!previewMode && screenshotUrl && (
                <figure className="report-screenshot">
                  <a href={screenshotUrl} target="_blank" rel="noreferrer">
                    <img src={screenshotUrl} alt={`Screenshot of ${bundle?.case.url ?? 'the venue page'} as researched`} loading="lazy" />
                  </a>
                  <figcaption>Venue page snapshot · re-checked weekly</figcaption>
                </figure>
              )}
              {bundle?.case.researchSources && bundle.case.researchSources.length > 0 && (
                <details className="report-sources">
                  <summary>
                    Researched {bundle.case.researchSources.length} page
                    {bundle.case.researchSources.length === 1 ? '' : 's'}
                    {bundle.case.researchModel ? ` · ${bundle.case.researchModel}` : ''}
                  </summary>
                  <ul>
                    {bundle.case.researchSources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {sourceLabel(source.url)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
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

          {caseStatus === 'failed' && !previewMode && (
            <div className="retry-bar">
              <p>{bundle?.case.error ?? 'Research stopped before the ledger could be completed.'}</p>
              <button
                type="button"
                className="secondary-action"
                onClick={() => void handleRetry()}
                disabled={isRetrying}
              >
                {isRetrying ? 'Retrying…' : 'Retry research'}
              </button>
            </div>
          )}

          {(bundle || previewMode) && caseStatus !== 'failed' && (
            <div className="share-bar">
              <button type="button" className="share-action" onClick={() => void handleCopyLink()}>
                Copy link
              </button>
              {!previewMode && (
                <button
                  type="button"
                  className="share-action"
                  onClick={() => void handleShareLink()}
                  disabled={isSharing}
                >
                  {isSharing ? 'Creating…' : 'Share page'}
                </button>
              )}
              <button type="button" className="share-action" onClick={handleCopySummary}>
                Copy summary
              </button>
              <button type="button" className="share-action" onClick={handleDownload}>
                Download .md
              </button>
              <button type="button" className="share-action" onClick={() => window.print()}>
                Print
              </button>
            </div>
          )}

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
                            <span className="priority-toggle__label">{selected ? 'Priority' : 'Mark priority'}</span>
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
                              <span className="priority-toggle__label">{selected ? 'Priority' : 'Mark priority'}</span>
                            </label>
                          </div>
                          {item.answer ? (
                            <p className="answer">{item.answer}</p>
                          ) : (
                            <p className="requirement-row__note">
                              {caseStatus === 'researching' || caseStatus === 'queued'
                                ? 'Checking the source…'
                                : caseStatus === 'failed'
                                  ? 'Not reviewed because research stopped.'
                                  : 'No supported answer found in the source.'}
                            </p>
                          )}
                          {item.evidence && (
                            <div className="evidence">
                              <p className="evidence__label">
                                {item.status === 'confirmed_venue' ? 'Venue reply evidence' : item.status === 'conflicting' ? 'Conflicting evidence — needs review' : 'Source evidence'}
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
                              <span className="sr-only"> (opens in new tab)</span>
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

          {showFollowup && (
            <aside className="followup" aria-label="Venue follow-up">
              <div>
                <h3>
                  {priorityUnknowns.length > 0
                    ? `${priorityUnknowns.length} prioritised question${priorityUnknowns.length === 1 ? '' : 's'} · ${unknownCount} unverified total`
                    : `${unknownCount} unverified detail${unknownCount === 1 ? '' : 's'} still worth asking`}
                </h3>
                <p>
                  AccessPing can turn the remaining unverified details into one focused venue message.
                  {sendsRemaining < MAX_SENDS_PER_CASE
                    ? ` ${sendsRemaining} of ${MAX_SENDS_PER_CASE} venue messages remaining for this check.`
                    : ''}
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
                          : outreachStatus === 'replied' && canResend
                            ? 'Send follow-up'
                            : outreachStatus === 'replied'
                              ? 'Venue replied'
                              : outreachLocked
                                ? 'Questions sent'
                                : 'Send questions'}
                      </button>

                      {sendError && (
                        <p className="outreach-message outreach-message--error" role="alert">
                          {sendError}
                        </p>
                      )}
                      {bundle?.outreach && !sendError && (
                        <p
                          className={`outreach-message outreach-message--${bundle.outreach.status}`}
                          role="status"
                          aria-live="polite"
                        >
                          {bundle.outreach.status === 'replied'
                            ? 'Venue reply received. Any explicitly answered details update in the ledger above.'
                            : bundle.outreach.status === 'failed'
                              ? 'Delivery failed. Check the address and try again.'
                              : `Sent to ${bundle.outreach.recipient}. Waiting for the venue reply.`}
                        </p>
                      )}
                      {bundle?.outreach && bundle.outreach.status === 'sent' && (
                        <button
                          type="button"
                          className="share-action"
                          onClick={() => void handleSyncReply()}
                          disabled={isSyncing}
                        >
                          {isSyncing ? 'Checking…' : 'Check reply'}
                        </button>
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
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {shareMessage && <p className="toast">{shareMessage}</p>}
        {syncMessage && <p className="toast">{syncMessage}</p>}
      </div>
    </main>
  )
}
function SharedLedger({ shareToken }: { shareToken: string }) {
  const shared = useQuery(api.cases.getSharedBundle, { shareToken })
  const screenshot = useQuery(
    api.cases.getScreenshotUrl,
    shared?.case.screenshotId ? { caseId: shared.case._id, shareToken } : 'skip',
  )

  const requirements = (shared?.requirements ?? []).map((item) => ({
    ...item,
    _id: item._id as string,
    status: item.status as RequirementStatus,
  }))
  const confirmed = requirements.filter(
    (r) => r.status === 'confirmed_web' || r.status === 'confirmed_venue',
  ).length
  const unknown = requirements.filter((r) => r.status === 'unknown').length
  const conflicting = requirements.filter((r) => r.status === 'conflicting').length

  return (
    <main className="app-shell">
      <a className="skip-link" href="#report-title">
        Skip to access ledger
      </a>
      <header className="topbar">
        <span className="brand" aria-label="AccessPing shared check">
          <BrandMark />
          <span className="brand-wordmark" aria-hidden="true">
            <span className="brand-wordmark__access">Access</span>
            <span className="brand-wordmark__ping">Ping</span>
          </span>
        </span>
        <p className="product-note">Shared read-only access check</p>
      </header>

      <div className="workbench" id="top">
        <section className="report-panel" aria-labelledby="report-title">
          <header className="report-head">
            <div className="report-head__copy">
              <p className="report-label">Shared access ledger</p>
              <h2 id="report-title">
                {shared ? (shared.case.venueName || 'Source review complete') : 'Loading shared check…'}
              </h2>
              <div className="report-status" aria-live="polite" aria-atomic="true">
                <p>
                  {shared === undefined
                    ? 'Loading the shared evidence…'
                    : shared === null
                      ? 'This share link is invalid or the check is no longer available.'
                      : `${confirmed} confirmed · ${unknown} unverified · ${conflicting} conflicting`}
                </p>
              </div>
              {shared?.case.url && <p className="report-url">{shared.case.url}</p>}
              {screenshot && (
                <figure className="report-screenshot">
                  <a href={screenshot} target="_blank" rel="noreferrer">
                    <img
                      src={screenshot}
                      alt={`Screenshot of ${shared?.case.url ?? 'the venue page'} as researched`}
                      loading="lazy"
                    />
                  </a>
                  <figcaption>Venue page snapshot</figcaption>
                </figure>
              )}
              {shared && shared.case.researchSources && shared.case.researchSources.length > 0 && (
                <details className="report-sources">
                  <summary>
                    Researched {shared.case.researchSources.length} page
                    {shared.case.researchSources.length === 1 ? '' : 's'}
                    {shared.case.researchModel ? ` · ${shared.case.researchModel}` : ''}
                  </summary>
                  <ul>
                    {shared.case.researchSources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {sourceLabel(source.url)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </header>

          <div className="ledger-note">
            <p>
              Unverified means the source did not state it — not that it is unavailable. Shared by
              the check owner; evidence as researched.
            </p>
          </div>

          <div className="ledger-head" aria-hidden="true">
            <span>Access detail</span>
            <span>Evidence state</span>
            <span>Source</span>
          </div>

          <div className="report-body">
            <ul className="requirement-list">
              {requirements.map((item) => {
                const domain = sourceDomain(item.sourceUrl)
                return (
                  <li className="requirement-row" key={item._id}>
                    <div className="requirement-row__detail">
                      <div className="requirement-row__name">
                        <h3>{item.label}</h3>
                      </div>
                      {item.answer ? (
                        <p className="answer">{item.answer}</p>
                      ) : (
                        <p className="requirement-row__note">
                          No supported answer found in the source.
                        </p>
                      )}
                      {item.evidence && (
                        <div className="evidence">
                          <p className="evidence__label">
                            {item.status === 'confirmed_venue'
                              ? 'Venue reply evidence'
                              : item.status === 'conflicting'
                                ? 'Conflicting evidence — needs review'
                                : 'Source evidence'}
                            {domain ? ` · ${domain}` : ''}
                          </p>
                          <blockquote>
                            <p>{item.evidence}</p>
                          </blockquote>
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
                          <span className="sr-only"> (opens in new tab)</span>
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
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
