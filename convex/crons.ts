import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Weekly venue re-verification: re-scrape researched venues, surface
// evidence flips as conflicts, and email opted-in owners about changes.
crons.weekly('venue recheck', { hourUTC: 9, minuteUTC: 0, dayOfWeek: 'monday' }, internal.recheck.runBatch, {})

// Retention hygiene: drop abandoned queued/failed cases older than 30 days.
crons.weekly('purge old cases', { hourUTC: 9, minuteUTC: 30, dayOfWeek: 'monday' }, internal.cases.purgeOld, {})

export default crons
