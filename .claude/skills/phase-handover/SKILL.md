---
name: phase-handover
description: Pick up or hand over a build phase of the Hub rewrite. Use when starting a phase (or its part b), and when a phase's checks are green and it is ready to close, before the security scan and commit.
---

# Phase handover

Each phase is one session. The handover file is the only memory that survives between sessions, so write it for the next session and for the developer, who runs the steps on the host.

Rules for what a phase may touch, and the finishing order, are in `CLAUDE.md` (Working agreement and Sandbox). The per-phase prompt, scope and **Done when** list are in `docs/build-plan.md`.

## Starting a phase

1. Read this phase's section of `docs/build-plan.md`, `docs/progress/progress.md`, and the previous phase's `docs/progress/progress-phase<N>.md`. For a part b, read part a of the same file.
2. List every **Follow-up** and **Blocker** in the previous handover that bears on this phase, plus matching entries in `docs/backlog.md`.
3. Propose a plan that covers the phase's **Done when** items and the follow-ups from step 2, and wait for the developer's approval.

Done when: the developer has approved a plan that names each relevant follow-up, either as in scope or as deferred with a reason.

## Finishing a phase

Start only when `npm run lint && npm run typecheck && npm test && npm run test:e2e` are green in this session. A check that can't run in the sandbox is recorded, not skipped silently.

1. Write `docs/progress/progress-phase<N>.md`. Match the shape of the previous handover:
   - title, **Date** (today, absolute) and **Status** (say which checks ran in the sandbox and which the developer must run on the host)
   - What was built
   - Key files
   - Decisions, with the reason for each
   - Steps to run on the host (commands in a `sh` block)
   - Blockers and missing packages (say "No packages are missing" when none are)
   - Follow-ups, each tagged with the phase it belongs to; anything out of scope also goes in `docs/backlog.md`

   For a part b, add a `## Part b: …` section to the same file instead of a new file.

2. Add a row to the summary table in `docs/progress/progress.md` and a `## Phase <N>: <name> (<date>)` section of three to eight bullets, linking to the phase file.
3. Check each **Done when** item in `docs/build-plan.md` against what was built. If one is unmet, say so in Status and Follow-ups.
4. Hand over to the `security-scan` skill, then `pre-commit-review`, then commit locally.

Done when: every **Done when** item is marked met or explained, every heading above is filled, and `progress.md` links to the phase file.

## Writing rules

- Write in British English and GOV.UK style.
- Write facts the code can't tell the next session: why a choice was made, what was tried and dropped, what the developer must do by hand.
- Requirement IDs are allowed in handover files, but not in tests or code comments (`CLAUDE.md`).
- Never paste migrated content, secrets, tokens or security findings into a handover.
