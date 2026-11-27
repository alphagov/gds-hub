---
name: security-scan
description: Security scan of this branch's changes against docs/secure-ai-development-practices.md. Use once tests are green and before the pre-commit review and any commit, or when asked for a security scan or audit.
---

# Security scan

The method, checks, severities and finding format all live in `docs/secure-ai-development-practices.md`. This skill sets the scope and order for this repo. It doesn't repeat that document.

## Scope

The changes since this branch left `main`, plus uncommitted work:

```sh
git diff --stat "$(git merge-base main HEAD)"
git status --short
```

Read every changed and new file in full, including tests, workflows, Dockerfiles, `.sbx/`, `.claude/` and docs.

## Steps

1. **Context.** Follow §0.1 steps 1 and 2. The trust boundaries, identity model and data rules for this service are in `CLAUDE.md` (Architecture rules, Identity, Data migration, Sandbox). Read them as the threat context, not as a checklist to restate.
2. **Checks.** Go through every `[R]` check in §10.1. Mark each one _applies to this diff_ or _not touched by this diff_. For each one that applies, look for the patterns in its row in the changed code.
3. **Repo rules.** Check the diff against each security rule in `CLAUDE.md`: JWT verification, sanitised markdown, `no-store` routes, audit rows in the same transaction, no credentials in the database, secrets only from env vars, no real keys or tokens in tests, no migrated data. Run `npm run check:no-migration-data`.
4. **Validate.** For each candidate finding, follow §0.1 step 5: trace the path from source to sink, run a negative control and label the evidence level. Drop anything that doesn't survive.
5. **Fix or raise.** Fix each confirmed finding in the code and rerun the checks it affects. Ask the developer before a fix that changes scope or design.
6. **Report in chat only.** Use the §0.3 format for findings and the §0.5 handling rules. End with one line per §10.1 check that applied: pass or finding ID.

Done when: every §10.1 `[R]` check is marked applied or not touched, every finding is fixed or raised with the developer, and `check:no-migration-data` passes.

## Where findings go

Findings are sensitive (§0.5). Report them to the developer in this conversation and nowhere else: keep them out of files, commit messages, handover files, the backlog and PR text. A fixed finding may be described in neutral terms in a commit message ("validate the redirect target"), without the vulnerability detail.
