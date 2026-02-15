# Improvement Notes

## What Is Not Ideal

1. Persistence path is fragile for packaged builds.
- `src/app.ts` stores `projects.json` under `app.getAppPath()`, which is often read-only when packaged.

2. Main-process VCS calls are synchronous and can block.
- `spawnSync` is used for Git/Perforce checks in `src/app.ts`, and these are requested per row from the renderer.

3. Renderer is monolithic.
- `src/renderer/renderer.ts` currently handles state, rendering, events, and orchestration in one file.

4. Type duplication exists.
- Core data shapes are declared in `src/types.ts` and duplicated again inside `src/renderer/renderer.ts`.

5. Error handling is shallow in several places.
- Some failures are reduced to generic status text; malformed inputs/cache are often silently ignored.

6. IPC surface is permissive.
- Filesystem/process actions are directly exposed via IPC without strong validation boundaries.

7. CI coverage is narrow.
- Current workflow builds only on Windows, while app positioning is cross-platform.

8. Test depth is limited.
- Existing E2E tests cover key dialogs, but not deeper flows like first-run Hub import, launch/focus edge cases, and persistence.

9. Documentation accuracy can drift.
- Runtime data-storage behavior and packaging behavior need tighter alignment in docs.

10. Build asset copy step is brittle.
- Renderer asset copying is hardcoded in an inline script in `package.json`.

## Suggestions

1. Store user data in `app.getPath("userData")` and add a small migration path.
2. Move VCS inspection off blocking sync calls; cache results and refresh asynchronously.
3. Split `src/app.ts` into focused modules (`store`, `unity`, `vcs`, `hub`, `ipc`).
4. Split renderer by features (`projects`, `installs`, `settings`) and shared state utilities.
5. Use one shared source of truth for types; avoid renderer-local duplicates.
6. Add IPC input validation and explicit allow-lists for path/process operations.
7. Expand CI to at least validate build/test on macOS/Linux in addition to Windows.
8. Expand E2E coverage for sorting, missing-path behaviors, theme persistence, and import flows.
9. Tighten README/DEV notes so storage/package behavior is explicit and current.
10. Replace manual renderer asset-copy scripting with a more maintainable build step as complexity grows.
