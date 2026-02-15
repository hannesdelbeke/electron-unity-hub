# Development Guide

This file contains development guidelines and architecture notes for this project.

`DEV.md` must not contain TODO lists. Keep implementation tasks in `TODO.md`.

## Purpose

- Build a minimal Unity project launcher with strong project-centric UX.
- Do not require Unity Hub for normal operation.
- On first run only, import Unity Hub projects/install metadata when Hub is installed.

## Current Product Requirements

- Left sidebar tabs:
  - `Projects`
  - `Unity Installs`
  - `Settings` (anchored bottom-left)
- Projects list:
  - Show `nickname` when present, otherwise show project `name`.
  - Single-click row launches/focuses project.
  - Show red warning for missing project path.
- Unity installs list:
  - Single-click row launches editor executable.
  - Show red warning for missing executable path.
- Settings:
  - Theme mode selector: `Match System`, `Dark`, `Light`.
  - Remove missing projects action.
- Add/New project UX:
  - Keep forms hidden by default.
  - Use dialogs from `Add` menu and `New Project` action only.
- First-run bootstrap:
  - If Unity Hub cache exists, import projects and editor metadata once.
  - Launcher must still function fully when Hub is not installed.

## Architecture

### Desktop app (Electron + TypeScript)

- Main process: `src/app.ts`
  - Project persistence (`projects.json`)
  - Unity launch/focus behavior
  - Git/Perforce status detection
  - Native dialogs (folder/file pickers)
  - Optional repo clone support via `git clone`
- Preload bridge: `src/preload.ts`
  - Exposes safe IPC API to renderer
- Shared types: `src/types.ts`
- Renderer (desktop UI)
  - Markup: `src/renderer/index.html`
  - Styles: `src/renderer/styles.css`
  - Logic: `src/renderer/renderer.ts`

### Browser demo (GitHub Pages, mock data)

Need for demo:
- Show the UI/flow publicly in a browser.
- Share a clickable preview from README.
- Keep demo independent of native Electron APIs.

Demo files:
- `docs/index.html`
- `docs/styles.css`
- `docs/demo.js`

Demo constraints:
- Mock data only.
- No real Unity launching.
- No local file dialogs.
- No real Git/Perforce operations.

## Development Rules

- Keep the UI minimal and project-first.
- Hide data-entry forms by default; show dialogs only when needed.
- Support both light and dark mode.
- Default theme must follow the OS theme preference.
- Keep renderer logic thin and deterministic.
- Prefer additive architecture changes over broad rewrites.
- Update `DEV.md` when architecture or key workflows change.
- Keep task planning in `TODO.md`, not in this file.
- Keep the GitHub Pages preview up to date after every major change.
- Keep the GitHub Pages experience interactive (single live mock app), not duplicate static + interactive launchers.
- GitHub Pages demo is built from app source automatically on every push to `main`/`master`; do not hand-edit or manually deploy `docs/` for routine updates.
- Maintain GitHub Actions packaging so end users can download builds without using npm/terminal.
- Always render and publish preview screenshots in dark mode.
- Use `docs/launcher-preview.svg` as the canonical preview asset (do not keep PNG duplicates).
- After updating the preview, ensure `README.md` references `docs/launcher-preview.svg`.
- GitHub Pages preview media must use a max display size to avoid oversized rendering.
- GitHub Pages preview should preserve widescreen layout; on mobile/tablet use horizontal scrolling instead of compressing to a narrow layout when needed.

## Major Change Checklist

Use this checklist after major UI or behavior updates:

- Update desktop app files and verify `npm run build` passes.
- Update the browser demo in `docs/` to reflect current UX and flows.
- Verify `docs/index.html` preview works locally.
- Push updates so GitHub Pages reflects the latest major change.
- Do not create manual deploy/build commits for Pages; deployment is handled by GitHub Actions.
- Confirm README links/screenshots still match current behavior.
- Confirm GitHub Actions build succeeds and produces downloadable app artifacts.

## Commit Policy

- Include a Codex co-author trailer on commits made with Codex assistance.
- Preferred trailer format:
  - `Co-authored-by: Codex <codex@openai.com>`

## Build and Run

Desktop app:

```bash
npm install
npm start
```

Desktop build only:

```bash
npm run build
```

Package Windows app (portable executable):

```bash
npm run package:win
```

## CI Build Artifacts

- Workflow file: `.github/workflows/build.yml`
- Trigger: pushes to `main` and `master` (plus manual dispatch)
- Output: downloadable Windows build artifact from the `release/` folder

## GitHub Pages Deploy

- Workflow file: `.github/workflows/pages.yml`
- Trigger: every push to `main` and `master` (plus manual dispatch)
- Build step: `npm run build:pages` (generates `pages-dist/` from current source + mock browser API)
- Deploy source: `pages-dist/`
- Deployment is automated; no manual Pages deploy step is required.

## Testing (AI Agent Instructions)

For Codex/Claude-style agents, use this flow when validating UI behavior:

- Install dependencies first:
  - `npm install`
- Build desktop assets:
  - `npm run build`
- Run Electron E2E tests:
  - `npm run test:e2e`

Playwright setup notes (high level):

- This project uses Playwright + Electron for real UI interaction tests.
- Test config is in `playwright.config.ts`.
- Test files live in `tests/e2e/`.
- If Playwright binaries are missing in a new environment, run:
  - `npx playwright install`

Expected outcome:

- E2E tests should verify key interactions like opening the `Add` menu and triggering `New Project`.
- If tests fail, prefer fixing renderer event wiring and null-safety before changing test assertions.
 
Static demo local preview:

```bash
cd docs
python -m http.server 8080
```

