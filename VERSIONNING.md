# Versioning Plan

## Goal

Show lightweight source-control status for each project (Git/Perforce now, extensible later), with icons and minimal UI clutter.

## Architecture Plan

1. Define a provider interface.
- `detect(projectPath) -> providerId | none`
- `getSummary(projectPath) -> normalized summary`
- `refresh(projectPath, mode)` where mode is `fast` or `manual-deep`
- capability flags (`incoming`, `outgoing`, `pendingWorkItems`, etc.)

2. Implement providers.
- `GitProvider`
- `PerforceProvider`
- `UnknownProvider` fallback
- future providers can be added without changing renderer contracts

3. Normalize summary output.
- `provider`: `git | perforce | other`
- `workspace`: branch/stream/workspace
- `state`: `clean | dirty | offline | error`
- `localChangesCount`
- `incomingCount`
- `outgoingCount`
- `pendingWorkItemsCount`
- `lastRefreshAt`
- `message`

4. Detection lifecycle.
- detect provider on startup and project add/import
- cache provider selection per project
- only re-detect when path changes or user triggers re-scan

5. Refresh policy.
- initial load uses fast summary only
- background refresh queue with bounded concurrency
- per-project cache TTL
- manual refresh action for immediate update

## Provider-Specific Fast Data

### Git

- `git rev-parse --is-inside-work-tree`
- `git status --porcelain=v1 --branch`
- optional background `git fetch --prune --quiet`
- recompute ahead/behind after fetch
- do not block UI on fetch

### Perforce

- `p4 -d <path> info`
- `p4 -d <path> client -o`
- `p4 -d <path> opened -m 1` (or bounded count)
- `p4 -d <path> changes -s pending -m <small>`
- do not run `p4 resolve` (too slow on large repos)

## UI Plan

1. Keep one compact Source Control column.
- icon (`git`, `p4`, generic)
- workspace label (branch/stream)
- small pills (`Dirty`, `In N`, `Out N`, `CL N`)

2. Provide details on demand.
- row `...` menu entry: `Version Control Details`
- dialog/panel shows normalized fields and last refresh time

3. Avoid clutter.
- unsupported metrics render as `—`
- offline/error shown as small status pill

## Performance and Reliability

- never run heavy VCS commands in render path
- run all VCS queries in main-process background jobs
- cache summaries and timestamps
- timebox each command and preserve last known good summary when refresh fails

## Rollout Phases

1. Foundation:
- provider abstraction
- cached detection
- icon + clean/dirty in table

2. Git signals:
- ahead/behind
- optional fetch refresh flow

3. Perforce signals:
- pending changelist counts
- robust offline/auth handling

4. Extensibility:
- shared details dialog
- additional provider plug-in points
