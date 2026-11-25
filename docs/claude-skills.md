# Claude Code project skills

Claude Code uses three shared skills at set points in every phase, so each phase is run the same way.

| Skill               | When Claude uses it                                            | What it does                                                                                                                                           |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `phase-handover`    | At the start of a phase, and when the phase's checks are green | Reads the previous handover and proposes a plan. At the end, writes `docs/progress/progress-phase<N>.md` and the summary in `progress.md`              |
| `security-scan`     | After the checks are green, before the review and any commit   | Scans the branch's changes against [secure-ai-development-practices.md](secure-ai-development-practices.md). Reports findings in the conversation only |
| `pre-commit-review` | After the security scan, before every commit                   | Reviews the change as an automated pull request reviewer would, fixes what it finds and reruns the checks                                              |

The order is set once, in the Working agreement in [CLAUDE.md](../CLAUDE.md). The skills point to `CLAUDE.md` and the security practices document for the rules rather than repeating them, so a rule only ever changes in one place.

## Where the skills live

The skills are in this repo, in `.claude/skills/<name>/SKILL.md`, and are committed like any other file. Anyone who clones the repo gets them, and Claude Code loads them automatically, both on a Mac and inside the `hub-dev` sandbox, because the sandbox mounts the repo at the same path.

We chose the repo over a shared skills kit because:

- the skills point to files in this repo, so they're versioned and reviewed with them
- changes go through the same pull request as the rules they depend on
- the sandbox needs no extra set-up step

If other repos need the same skills later, the general parts can move into a kit and be installed with `sbx skills add` (see the backlog).

To change a skill, edit its `SKILL.md` and open a pull request. Keep personal skills in `~/.claude/skills`, not in the repo. `.claude/settings.local.json` is git-ignored.

## `sbx skills import`

Tried with sbx 0.54.0 on 2026-11-23, where the command is marked experimental:

```sh
sbx skills import --dry-run -v
```

It only checks agent folders in the developer's home directory (`~/.agents/skills`, `~/.claude/skills`, `~/.copilot/skills`, `~/.cursor/skills` and others) and copies what it finds into one store that every sandbox shares. It never reads the repo. On the test machine it would have imported one unrelated personal skill and none of the Hub skills.

**Recommendation: don't use it for this project.** It can't see the project skills, and it would put each developer's personal skills into every sandbox, so sessions would differ from person to person. The repo skills already reach the sandbox. `sbx skills add <git repo>` is the better fit if we move to a shared kit.

## Evidence that Claude uses each skill at the right point

Tested on 2026-11-23 with Claude Code 2.1.330 in headless mode (`claude -p`), in a throwaway worktree with this branch's skills. The runs couldn't push.

| Prompt                                                                                                    | Skills used, in order                                  | Result                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| "Start phase 6 of the build plan."                                                                        | `phase-handover`                                       | Read the build plan, progress log, Phase 5 handover and backlog, then proposed a plan and waited   |
| "The phase 6 code is written, and lint, typecheck, test and test:e2e have just passed. Finish the phase." | `phase-handover`                                       | Stopped before writing a handover, because the worktree had no Phase 6 code                        |
| "I've reworded the logging item in docs/backlog.md. Commit it."                                           | `security-scan`, then `pre-commit-review`, then commit | Committed locally after both skills. The review also flagged a broken link elsewhere on the branch |

Inside the `hub-dev` sandbox (Claude Code 2.1.314), Claude listed all three skills from the mounted repo.

The skills were also used to finish this change: `security-scan`, then `pre-commit-review`, then a local commit. `phase-handover` wasn't used, because this change isn't a build-plan phase.
