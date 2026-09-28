# Story Ledger

A growth-ledger plugin for serialized fiction, modeled on the ledger format of
a long-running AI-written novel project (characters / locations / open hooks as
markdown tables).

Status marks: ② not yet appeared · ① appeared · ◐ expanded · ✓ paid off.

## Commands

- **登记配角 (register character)** — name, identity/function, status, first
  chapter, growth notes. Appends to the character table.
- **登记地点 (register location)** — location, narrative function, status,
  first chapter.
- **埋钩子 (plant hook)** — description, buried-at chapter (auto-detected from
  the active note's filename, e.g. `第12章`), planned payoff chapter (required
  by the v2.3 rule), auto-numbered H1, H2, …
- **钩子对账 (reconcile hooks)** — side panel listing every unpaid-off hook;
  items buried 6+ chapters ago are flagged as 陈账 (stale) and must be checked
  before any plotting decision.
- **打开台账 (open ledger)** — opens the ledger file.

## Ledger file

Defaults to `生长台账.md` in the vault root (configurable). Created on first
use with the three-section template. All data is plain markdown — edit by hand
any time, the views re-parse on refresh.

## Notes

- Plain JavaScript, no build step; runs entirely offline.
