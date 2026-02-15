# Roadmap Plan

## Guiding Goals

1. Keep the launcher minimal and project-focused.
2. Improve reliability/performance before adding broad new scope.
3. Keep architecture easy for AI and human contributors to extend.

## Phase 1: Stability and Correctness (Short Term)

1. Move persistent storage to a writable user-data location.
2. Add migration for existing `projects.json` data.
3. Improve error messaging for launch/import/clone failures.
4. Add tests for:
- Table sorting behavior (including modified date sort).
- Missing-path warning and remove-missing flow.
- Theme persistence across restart.

## Phase 2: Architecture and Maintainability (Near Term)

1. Refactor main process into modules:
- Store service
- Unity service
- VCS service
- Hub import service
- IPC registration layer
2. Refactor renderer into tab/view modules with shared state helpers.
3. Remove duplicate type definitions and centralize contracts in `src/types.ts`.

## Phase 3: Performance and UX Quality (Mid Term)

1. Replace blocking VCS checks with async/background refresh.
2. Add caching and visible refresh states for VCS/install detection.
3. Improve large-list behavior:
- Faster row updates
- Reduced repeated expensive calls

## Phase 4: Release and Platform Maturity (Mid/Late Term)

1. Expand CI to validate cross-platform build/test quality.
2. Keep Windows artifacts for distribution; add macOS/Linux packaging plan.
3. Document unsigned build behavior and trust/onboarding steps clearly.

## Phase 5: Extensibility for Future Integrations (Long Term)

1. Define a simple provider interface for source-control integrations.
2. Add non-invasive metadata model for project annotations and future filters.
3. Keep desktop app and docs demo behavior aligned after major feature changes.
