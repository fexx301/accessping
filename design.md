# Design — AccessPing

A locked design system for the AccessPing app. Future UI work should read this file before changing visual structure, typography, colour, spacing, states, or interaction voice.

## Genre

Modern-minimal, with an austere and trustworthy product voice. The interface should feel like a careful research instrument for ordinary people, not a dark AI dashboard or a marketing landing page.

## Macrostructure family

- App pages: Workbench / split-workspace. The task control lives in a compact rail; evidence and state live in the larger work surface.
- Marketing pages: restrained split hero followed by real product evidence, never a generic three-card feature grid.
- Content pages: long document with strong typography and quiet rules.

## Theme

- `--color-paper`: warm near-white
- `--color-paper-2`: warm soft-grey
- `--color-ink`: brown-charcoal
- `--color-ink-2`: softer charcoal
- `--color-rule`: warm hairline
- `--color-accent`: restrained coral-red signal colour
- `--color-focus`: darker coral focus ring

The accent is a signal, not a flood. Semantic success/warning/error colours may appear only when they communicate state.

## Typography

- Display: Manrope 700–800, roman only
- Body: Inter 400–700
- No italic display text
- Display tracking is tight; body copy stays relaxed and highly readable

## Spacing

4-point named scale from `--space-3xs` through `--space-2xl`. Production CSS should consume tokens rather than introduce one-off spacing values unless a geometry constraint genuinely requires one.

## Motion

- Motion-cut by default
- Hover transitions may change colour or move by 1px
- Focus appears instantly and never animates
- Reduced-motion removes non-essential transitions

## Microinteractions stance

- Quiet state changes; no celebratory confetti or animated AI glows
- Every interactive control needs visible hover, focus, active, disabled, loading, error, and success treatment where applicable
- Inputs keep constant border width across states
- Buttons and inputs share the same minimum 48px control height in the primary form

## CTA voice

- Primary: solid accent, compact radius, direct verb phrase
- Secondary: ink/paper inversion, compact radius
- Never gradient, glass, glow, or oversized pill treatment

## Per-page allowances

- App pages: no decorative enrichment. Function carries the page.
- Marketing pages: restrained product screenshots or diagrams only when they communicate the workflow.
- Content pages: typography and rules only.

## What pages MUST share

- AccessPing wordmark and square “A” mark
- Warm paper / charcoal / coral token system
- Manrope + Inter pairing
- Compact-radius controls
- Evidence-first status language: confirmed, unverified, conflicting
- Source links remain visually subordinate to the evidence they support

## What pages MAY differ on

- Density of the work surface
- Whether the control rail is left, top, or collapsible on smaller screens
- Section structure appropriate to the route’s task

