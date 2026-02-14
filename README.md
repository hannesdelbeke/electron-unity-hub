# Unity Launcher (MVP)

![Launcher Preview](./docs/launcher-preview.svg)

A lightweight Unity project launcher focused on projects, not cloud/learning tabs.

Live demo (mock data): https://hannesdelbeke.github.io/electron-unity-hub/

Project development instructions and architecture: [DEV.md](./DEV.md)

Project TODOs are intentionally kept out of `DEV.md`. Use [TODO.md](./TODO.md) for task tracking.

## Implemented features

- Project nickname support (including multiple entries for the same project path)
- Project name, path
- Unity editor version detection (`ProjectSettings/ProjectVersion.txt`) with override field
- Last opened timestamp
- Source control status (Git + Perforce detection)
- Open behavior for already-open projects:
  - If project appears open (`Temp/UnityLockfile`), the app attempts to focus that Unity window instead of launching a duplicate
- Launch with a configured Unity executable path

## Requirements

- Node.js 20+
- npm 10+
- Windows/macOS/Linux (window focusing is currently implemented for Windows only)

## Run

```bash
npm install
npm start
```

## Browser Demo

The browser demo is static and mock-only. It does not launch Unity, access local disk, or run real source-control commands.

To run locally:

```bash
cd docs
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Notes

- Desktop app data is stored in `projects.json` in the repo root.
- Git information is read using `git` CLI if available.
- Perforce information is read using `p4` CLI if available.
- The desktop app is intentionally read-only for source control status (no submit/sync actions).
