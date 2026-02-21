# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Agent Learnings (2026-02-21)

- `bd` can crash with Dolt nil-pointer panics when multiple `bd` commands run concurrently. Run `bd` commands sequentially (especially `bd show`, `bd ready`, and list/show mixes).
- If `git push` fails with "Uncommitted changes detected", run `bd sync` and check `git status`. `bd sync` can modify `.beads/issues.jsonl`; commit that file before retrying push.
- Expected untracked local artifacts: `.beads/dolt-access.lock`, `.beads/dolt/`, `.beads/ephemeral.sqlite3`. These are runtime artifacts, not feature changes.
- Host action security is intentional: for `ACTION_MOVE`, `ACTION_PASS`, and `ACTION_EXCHANGE`, host-side handling should trust `meta.remotePlayerId`, not wire `msg.playerId`.
- `SYNC_STATE` privacy is intentional: use `buildSyncStateForPeer` to redact racks so peers only receive their own rack tiles.
- Endgame "no moves" detection should run through `EndgameScanController` + worker flow. Do not reintroduce expensive main-thread `checkGameEnd` scans in `placeMove`.
- Worker endgame scan runs only when bag is empty and below the 50% initial-bag heuristic. If endgame auto-finish appears "missing", check those guards first.
- Reconnection behavior: host `triggerReconnect()` should regenerate offers automatically if host setup context exists; otherwise show explicit manual-refresh guidance.
- Useful focused verification commands:
- `npm run test:run -- src/controllers/<file>.test.ts`
- `npm run test:run -- src/core/<file>.test.ts`
- `npm run lint`
- `npm run build`
