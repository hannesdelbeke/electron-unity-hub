# Unity Launcher (MVP)

A lightweight Unity project launcher focused on projects, not cloud/learning tabs.

## Implemented features

- Project nickname support (including multiple entries for the same project path)
- Project name, path
- Unity editor version detection (`ProjectSettings/ProjectVersion.txt`) with override field
- Last opened timestamp
- Source control status (Git + Perforce detection)
- Open behavior for already-open projects:
  - If project appears open (`Temp/UnityLockfile`), the app attempts to focus that Unity window instead of launching a duplicate
- Launch with a configured Unity executable path
- Quick buttons to open Unity Hub and Unity Hub install page

## Requirements

- Node.js 20+
- npm 10+
- Windows/macOS/Linux (window focusing is currently implemented for Windows only)

## Run

```bash
npm install
npm start
```

## Notes

- Data is stored in `projects.json` in the repo root.
- Git information is read using `git` CLI if available.
- Perforce information is read using `p4` CLI if available.
- This is an MVP and intentionally read-only for source control status (no submit/sync actions).
