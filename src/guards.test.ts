import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyReplyUpdate,
  diffRecheck,
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

describe('diffRecheck', () => {
  it('upgrades new confirmations, flags vanished evidence, never touches venue rows', () => {
    const changes = diffRecheck(
      [
        { key: 'a', label: 'A', status: 'unknown' },
        { key: 'b', label: 'B', status: 'confirmed_web', answer: 'Step-free at west door', evidence: 'Use the west door.' },
        { key: 'c', label: 'C', status: 'confirmed_venue', answer: 'Yes', evidence: 'Yes.' },
      ],
      [
        { key: 'a', label: 'A', status: 'confirmed_web', answer: 'Step-free listed', evidence: 'Step-free listed.', sourceUrl: 'https://venue.example/access' },
        { key: 'b', label: 'B', status: 'unknown', answer: null, evidence: null, sourceUrl: null },
        { key: 'c', label: 'C', status: 'unknown', answer: null, evidence: null, sourceUrl: null },
      ],
    )
    assert.equal(changes.length, 2)
    assert.equal(changes[0].kind, 'confirmed')
    assert.equal(changes[1].kind, 'vanished')
  })

  it('flags changed web answers for review and ignores identical rows', () => {
    const changes = diffRecheck(
      [
        { key: 'a', label: 'A', status: 'confirmed_web', answer: 'Same', evidence: 'Same.' },
        { key: 'b', label: 'B', status: 'confirmed_web', answer: 'Old', evidence: 'Old.' },
      ],
      [
        { key: 'a', label: 'A', status: 'confirmed_web', answer: 'Same', evidence: 'Same.', sourceUrl: null },
        { key: 'b', label: 'B', status: 'confirmed_web', answer: 'New', evidence: 'New.', sourceUrl: null },
      ],
    )
    assert.equal(changes.length, 1)
    assert.equal(changes[0].kind, 'changed')
  })
})
