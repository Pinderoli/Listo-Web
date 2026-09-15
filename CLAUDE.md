# Listo-Web

Web version of Listo: make, reset, and share repeatable checklists (hiking
packing lists, business trip lists, site safety checklists, anything you
do over and over).

## Concept

- A **list** has an ordered set of **sections** (fixed categories like
  "Clothes" / "Food" / "Documents" — not drag-between swim lanes).
- Each section has an ordered set of **items** with a checked/unchecked
  state.
- **Reset** unchecks every item in a list in one tap, so the same list can
  be reused trip after trip.
- **Sharing** is file-based for now: export a list to a `.listo.json` file
  (AirDrop/email/etc. it) and the recipient imports it as their own copy.
  No accounts, no backend, no live sync yet — that's deliberately deferred.

## Status

Working v1: create/rename/delete lists, add/rename/delete sections and
items, check/uncheck, reset, export/import via JSON file. Persisted to
`localStorage` only (per-browser, not synced across devices).

## Stack

Plain HTML/CSS/JS, no build step, no framework, no dependencies. Deploys
directly to GitHub Pages by serving the repo root. Keep it this way unless
there's a concrete reason to add tooling — revisit this section if that
changes.

## Structure

- `index.html` — app shell (header + nav + main view containers).
- `styles.css` — design system (CSS variables for color/radius/spacing,
  component styles). Primary color is orange (`--color-primary`),
  secondary is yellow (`--color-secondary`). Rounded corners, soft
  shadows, smooth transitions — clean/modern, Apple-ish feel.
- `app.js` — all app logic: state, persistence (`localStorage`), rendering
  (vanilla DOM, re-renders on every mutation — no virtual DOM), and
  import/export. Single `state = { lists, activeListId }` object is the
  source of truth.

## Data model

```
List:    { id, name, sections: Section[] }
Section: { id, name, items: Item[] }
Item:    { id, text, checked }
```

Export format wraps a list as `{ listo: true, version: 1, exportedAt, list }`.
Import accepts that wrapper or a bare `list` object, and always assigns
fresh IDs and unchecks items so an imported list starts clean.

## Deliberately deferred (don't build yet unless asked)

- Accounts / login
- Any server or shared database (GitHub Pages can't run one anyway)
- Real-time collaboration on a shared list
- Social/discovery feed of public lists
- Native iOS/Android apps — web is the starting platform

## Working in this repo

- Keep changes small and commit with clear messages.
- No build step exists — don't introduce one (npm, bundlers, TS) without
  a clear reason, and update this file if you do.
- Test changes by opening `index.html` directly or via a static server;
  there's no test suite yet.
- `index.html` loads `styles.css`/`app.js` with a `?v=N` cache-busting
  query param. GitHub Pages/Safari can cache these aggressively, so bump
  `N` whenever either file changes or a device may keep running stale JS.
