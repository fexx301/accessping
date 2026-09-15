// Pure, dependency-free guards shared by Convex functions and the frontend.
// Keep this file free of `convex/*` imports so it stays unit-testable with
// the Node built-in test runner.

export const MAX_SENDS_PER_CASE = 3
export const SEND_COOLDOWN_MS = 60 * 1000
export const MAX_RESEARCH_ATTEMPTS = 3
export const MAX_CASES_PER_HOUR = 60

export function isValidHttpUrl(url: string): boolean {
  const trimmed = url.trim()
  if (trimmed.length === 0 || trimmed.length > 2000) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!isValidHttpUrl(trimmed)) {
    throw new Error('Use a complete http:// or https:// venue or event URL.')
  }
  return trimmed
}

export function isValidEmail(email: string): boolean {
  const clean = email.trim().toLowerCase()
  if (clean.length === 0 || clean.length > 320) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)
}

export function sendGuard(args: {
  outreachCount: number
  latestUpdatedAt: number | null
  now?: number
}): { ok: true } | { ok: false; reason: string } {
  const now = args.now ?? Date.now()
  if (args.outreachCount >= MAX_SENDS_PER_CASE) {
    return { ok: false, reason: 'This case has already sent the maximum number of venue messages.' }
  }
  if (args.latestUpdatedAt !== null && now - args.latestUpdatedAt < SEND_COOLDOWN_MS) {
    return { ok: false, reason: 'Please wait a minute before sending another venue message.' }
  }
  return { ok: true }
}

export type PriorStatus = 'confirmed_web' | 'confirmed_venue' | 'unknown' | 'conflicting'

export function classifyReplyUpdate(priorStatus: PriorStatus): 'confirm' | 'conflict' | 'skip' {
  if (priorStatus === 'confirmed_venue') return 'skip'
  if (priorStatus === 'unknown') return 'confirm'
  return 'conflict'
}

// Signals that a discovered URL likely carries accessibility evidence.
export const ACCESS_KEYWORDS = [
  'access',
  'disab',
  'wheel',
  'step-free',
  'stepfree',
  'hearing',
  'loop',
  'caption',
  'sign-language',
  'signlanguage',
  'bsl',
  'asl',
  'sensory',
  'quiet',
  'parking',
  'drop-off',
  'dropoff',
  'toilet',
  'restroom',
  'wc-',
  '/wc',
  'entrance',
  'egress',
  'lift',
  'elevator',
  'ramp',
  'seating',
  'companion',
  'assistance',
  'service-animal',
  'service-dog',
  'guide-dog',
  'braille',
  'large-print',
  'largeprint',
  'audio-description',
  'audiodescription',
  'induction',
  'inclusion',
  'inclusive',
  'visitor-info',
  'plan-your-visit',
  'know-before-you-go',
  'faq',
]

const SKIP_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.mp4',
  '.mp3',
  '.wav',
  '.zip',
  '.css',
  '.js',
]

export function rankAccessibility(rawUrl: string): number {
  const lowered = rawUrl.toLowerCase()
  let score = 0
  for (const keyword of ACCESS_KEYWORDS) {
    if (lowered.includes(keyword)) score += keyword.length >= 6 ? 3 : 2
  }
  try {
    const parsed = new URL(rawUrl)
    const path = parsed.pathname.toLowerCase()
    if (/(access|disab|inclu|facilit|visitor|plan-your-visit|know-before)/.test(path)) score += 4
    if (parsed.pathname.split('/').filter(Boolean).length > 5) score -= 2
  } catch {
    return -1
  }
  return score
}

export function sameOriginOnly(urls: string[], origin: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of urls) {
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      continue
    }
    if (parsed.origin !== origin) continue
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    const path = parsed.pathname.toLowerCase()
    if (SKIP_EXTENSIONS.some((ext) => path.endsWith(ext))) continue
    parsed.hash = ''
    const key = parsed.toString()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}
