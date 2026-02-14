# Development Guide

This file contains development guidelines and architecture notes for this project.

`DEV.md` must not contain TODO lists. Keep implementation tasks in `TODO.md`.

## Purpose

- Build a minimal Unity project launcher with strong project-centric UX.
- Keep Unity Hub for installs/new-project creation, while this app focuses on launching and project management.

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
- Maintain GitHub Actions packaging so end users can download builds without using npm/terminal.

## Major Change Checklist

Use this checklist after major UI or behavior updates:

- Update desktop app files and verify `npm run build` passes.
- Update the browser demo in `docs/` to reflect current UX and flows.
- Verify `docs/index.html` preview works locally.
- Push updates so GitHub Pages reflects the latest major change.
- Confirm README links/screenshots still match current behavior.
- Confirm GitHub Actions build succeeds and produces downloadable app artifacts.

Temporary exception:
- The next major desktop change may be merged once without updating GitHub Pages preview (one-time exception requested). Resume normal preview updates after that.

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

Static demo local preview:

```bash
cd docs
python -m http.server 8080
```
