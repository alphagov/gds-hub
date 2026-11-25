---
name: pre-commit-review
description: Review the pending change as an automated pull request reviewer and fix what it would flag. Use after the security scan and before every commit, or when asked to review the branch before a PR.
---

# Pre-commit review

Act as the automated reviewer that will comment on this branch's pull request. Find what it would flag, fix it, and leave a diff with nothing left to comment on. The rules being enforced are in `CLAUDE.md`; this skill sets the scope and the passes.

## Scope

Everything that will be in the pull request:

```sh
git diff "$(git merge-base main HEAD)"
git status --short
```

Read each changed file in full, not only the hunks, so you see the surrounding code the reviewer will see.

## Passes

Make each pass over the whole diff and note every issue before fixing anything.

1. **Repo rules.** Apply every rule in `CLAUDE.md` (Stack, Architecture rules, Identity, Data migration, Sandbox, Working agreement, Language) to the diff. A rule broken anywhere in the diff is an issue.
2. **Correctness.** Logic errors, unhandled errors and edge cases, wrong types hidden by casts or `any`, dead code, leftover debug output, and behaviour that doesn't match the phase's **Done when** items in `docs/build-plan.md`.
3. **Tests.** Every new behaviour has a test at the right level (Vitest for functions and modules, Playwright for what a user does and sees), named by behaviour. Tests fail if the behaviour breaks.
4. **Consistency.** New code follows the patterns already in `src/`. Docs, README, `.env.example`, `.github/workflows/test.yml` and handover files match the code, with no stale commands, paths or names.
5. **Copy.** UI text and docs are in British English and GOV.UK style.

## Fix and confirm

1. Fix every issue. If a fix would change scope or design, ask the developer instead, and log the idea in `docs/backlog.md` if it's out of scope.
2. Rerun `npm run lint && npm run typecheck && npm test && npm run test:e2e` and `npm run check:no-migration-data`. If the fixes changed code, update the handover file to match.
3. Tell the developer what you found and fixed in a short list, then commit locally. Never push.

Done when: every pass has covered the whole diff, every issue is fixed or raised with the developer, and the checks are green after the last fix.
