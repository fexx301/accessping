import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyReplyUpdate,
  isValidEmail,
  isValidHttpUrl,
  normalizeUrl,
  rankAccessibility,
  sameOriginOnly,
  sendGuard,
} from '../convex/guards.ts'

describe('isValidHttpUrl', () => {
  it('accepts http and https URLs', () => {
    assert.equal(isValidHttpUrl('https://venue.example/event'), true)
    assert.equal(isValidHttpUrl('http://venue.example/'), true)
  })

  it('rejects non-web, empty, and oversized URLs', () => {
    assert.equal(isValidHttpUrl(''), false)
    assert.equal(isValidHttpUrl('ftp://venue.example/x'), false)
    assert.equal(isValidHttpUrl('not a url'), false)
    assert.equal(isValidHttpUrl(`https://${'a'.repeat(2000)}.example`), false)
  })
})

describe('normalizeUrl', () => {
  it('trims and returns valid URLs', () => {
    assert.equal(normalizeUrl('  https://venue.example/a  '), 'https://venue.example/a')
  })

  it('throws for invalid URLs', () => {
    assert.throws(() => normalizeUrl('notaurl'), /http/)
  })
})

describe('isValidEmail', () => {
  it('accepts normal addresses and rejects junk', () => {
    assert.equal(isValidEmail('access@venue.example'), true)
    assert.equal(isValidEmail('bad'), false)
    assert.equal(isValidEmail('a@b'), false)
    assert.equal(isValidEmail(''), false)
  })
})

describe('sendGuard', () => {
  it('enforces the per-case cap', () => {
    const result = sendGuard({ outreachCount: 3, latestUpdatedAt: null, now: 1000 })
    assert.equal(result.ok, false)
  })

  it('enforces the cooldown window', () => {
    const now = 120_000
    const tooSoon = sendGuard({ outreachCount: 1, latestUpdatedAt: now - 10_000, now })
    assert.equal(tooSoon.ok, false)
    const cooled = sendGuard({ outreachCount: 1, latestUpdatedAt: now - 61_000, now })
    assert.equal(cooled.ok, true)
  })

  it('allows the first send', () => {
    assert.equal(sendGuard({ outreachCount: 0, latestUpdatedAt: null, now: 0 }).ok, true)
  })
})

describe('classifyReplyUpdate', () => {
  it('confirms unknowns, conflicts web rows, skips venue rows', () => {
    assert.equal(classifyReplyUpdate('unknown'), 'confirm')
    assert.equal(classifyReplyUpdate('confirmed_web'), 'conflict')
    assert.equal(classifyReplyUpdate('conflicting'), 'conflict')
    assert.equal(classifyReplyUpdate('confirmed_venue'), 'skip')
  })
})

describe('rankAccessibility', () => {
  it('scores accessibility URLs above generic pages', () => {
    const access = rankAccessibility('https://venue.example/accessibility')
    const generic = rankAccessibility('https://venue.example/events/lineup')
    assert.ok(access > generic)
    assert.ok(access > 0)
  })

  it('rejects unparsable URLs', () => {
    assert.equal(rankAccessibility('not a url'), -1)
  })
})

describe('sameOriginOnly', () => {
  it('keeps same-origin http URLs, drops the rest and dedupes', () => {
    const out = sameOriginOnly(
      [
        'https://venue.example/accessibility',
        'https://venue.example/accessibility#main',
        'https://other.example/accessibility',
        'https://venue.example/logo.png',
        'notaurl',
      ],
      'https://venue.example',
    )
    assert.deepEqual(out, ['https://venue.example/accessibility'])
  })
})
