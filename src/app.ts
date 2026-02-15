import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectEntry, UnityInstall, VcsStatus } from "./types";

type StoreMeta = {
  firstRunBootstrapDone?: boolean;
  disableRenderThrottling?: boolean;
};

type StoreShape = {
  projects: ProjectEntry[];
  meta: StoreMeta;
};

function getDataFile(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

function normalizePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function emptyStore(): StoreShape {
  return {
    projects: [],
    meta: {},
  };
}

function loadStore(): StoreShape {
  const dataFile = getDataFile();
  if (!existsSync(dataFile)) {
    return emptyStore();
  }
  try {
    const payload = JSON.parse(readFileSync(dataFile, "utf-8")) as Partial<StoreShape>;
    return {
      projects: payload.projects ?? [],
      meta: payload.meta ?? {},
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: StoreShape): void {
  const dataFile = getDataFile();
  writeFileSync(dataFile, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function detectUnityVersion(projectPath: string): string {
  const versionFile = path.join(projectPath, "ProjectSettings", "ProjectVersion.txt");
  if (!existsSync(versionFile)) {
    return "";
  }
  const txt = readFileSync(versionFile, "utf-8");
  const line = txt.split(/\r?\n/).find((x) => x.startsWith("m_EditorVersion:"));
  return line ? line.split(":", 2)[1].trim() : "";
}

const projectIconCache = new Map<string, string>();
const guidPathCache = new Map<string, string>();

function mimeFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function toDataUrl(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }
  try {
    const bytes = readFileSync(filePath);
    return `data:${mimeFromExtension(filePath)};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

function findAssetByGuid(assetsRoot: string, guid: string): string {
  const guidKey = guid.toLowerCase();
  const cached = guidPathCache.get(guidKey);
  if (cached && existsSync(cached)) {
    return cached;
  }

  const stack: string[] = [assetsRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    let entries: ReturnType<typeof readdirSync> | Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".meta")) {
        continue;
      }
      try {
        const txt = readFileSync(fullPath, "utf-8");
        if (!txt.includes(`guid: ${guid}`)) {
          continue;
        }
        const assetPath = fullPath.slice(0, -".meta".length);
        guidPathCache.set(guidKey, assetPath);
        return assetPath;
      } catch {
        // Ignore unreadable meta file.
      }
    }
  }
  return "";
}

function detectProjectIconDataUrl(projectPath: string): string {
  const cacheKey = normalizePath(projectPath);
  if (projectIconCache.has(cacheKey)) {
    return projectIconCache.get(cacheKey) ?? "";
  }

  const settingsPath = path.join(projectPath, "ProjectSettings", "ProjectSettings.asset");
  if (!existsSync(settingsPath)) {
    projectIconCache.set(cacheKey, "");
    return "";
  }

  let settingsText = "";
  try {
    settingsText = readFileSync(settingsPath, "utf-8");
  } catch {
    projectIconCache.set(cacheKey, "");
    return "";
  }

  const iconStart = settingsText.indexOf("m_BuildTargetIcons:");
  const iconSection = iconStart >= 0 ? settingsText.slice(iconStart, iconStart + 100_000) : settingsText;
  const guidMatches = [...iconSection.matchAll(/guid:\s*([0-9a-f]{32})/gi)];
  if (guidMatches.length === 0) {
    projectIconCache.set(cacheKey, "");
    return "";
  }

  const assetsRoot = path.join(projectPath, "Assets");
  for (const match of guidMatches) {
    const guid = (match[1] ?? "").toLowerCase();
    if (!guid) {
      continue;
    }
    const assetPath = findAssetByGuid(assetsRoot, guid);
    if (!assetPath) {
      continue;
    }
    const iconDataUrl = toDataUrl(assetPath);
    if (!iconDataUrl) {
      continue;
    }
    projectIconCache.set(cacheKey, iconDataUrl);
    return iconDataUrl;
  }

  projectIconCache.set(cacheKey, "");
  return "";
}

function getHubCandidates(): string[] {
  const appData = app.getPath("appData");
  const candidates = [path.join(appData, "UnityHub")];

  if (process.platform === "linux") {
    const home = process.env.HOME ?? "";
    candidates.push(path.join(home, ".config", "UnityHub"));
    candidates.push(path.join(home, ".local", "share", "UnityHub"));
  }

  return [...new Set(candidates)];
}

function findHubFile(fileName: string): string {
  for (const base of getHubCandidates()) {
    const candidate = path.join(base, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function bootstrapFromHubOnFirstRun(store: StoreShape): StoreShape {
  if (store.meta.firstRunBootstrapDone) {
    return store;
  }

  const hubProjectsFile = findHubFile("projects-v1.json");
  if (hubProjectsFile && existsSync(hubProjectsFile)) {
    type HubProject = {
      path?: string;
      title?: string;
      projectName?: string;
      version?: string;
      lastModified?: number;
    };
    type HubPayload = { data?: Record<string, HubProject> };

    try {
      const payload = JSON.parse(readFileSync(hubProjectsFile, "utf-8")) as HubPayload;
      const incoming = payload.data ?? {};
      const existing = new Set(store.projects.map((p) => normalizePath(p.path)));

      for (const [keyPath, item] of Object.entries(incoming)) {
        const projectPath = (item.path ?? keyPath ?? "").trim();
        if (!projectPath) {
          continue;
        }
        const norm = normalizePath(projectPath);
        if (existing.has(norm)) {
          continue;
        }

        const baseName = path.basename(projectPath);
        const displayName = (item.projectName ?? item.title ?? baseName).trim() || baseName;
        const lastOpenedIso =
          typeof item.lastModified === "number" && Number.isFinite(item.lastModified)
            ? new Date(item.lastModified).toISOString()
            : "";

        store.projects.push({
          id: randomUUID(),
          nickname: displayName,
          name: displayName,
          path: projectPath,
          unityVersion: (item.version ?? "").trim() || detectUnityVersion(projectPath),
          unityExe: "",
          lastOpenedIso,
        });
        existing.add(norm);
      }
    } catch {
      // Ignore malformed hub cache.
    }
  }

  store.meta.firstRunBootstrapDone = true;
  saveStore(store);
  return store;
}

function inferVersionFromPath(exePath: string, fallback = "unknown"): string {
  const parts = exePath.split(/[\\/]/);
  for (const part of parts) {
    if (/^\d{4}\.\d+\.\d+[a-z]\d+$/i.test(part) || /^\d+\.\d+\.\d+[a-z]\d+$/i.test(part)) {
      return part;
    }
  }
  return fallback;
}

function addInstall(candidates: UnityInstall[], seen: Set<string>, install: UnityInstall): void {
  const normalized = normalizePath(install.path);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  candidates.push(install);
}

function addInstallIfExists(candidates: UnityInstall[], seen: Set<string>, install: UnityInstall): void {
  if (!install.exists) {
    return;
  }
  addInstall(candidates, seen, install);
}

function scanInstallRoot(baseRoot: string, candidates: UnityInstall[], seen: Set<string>, source: string): void {
  if (!existsSync(baseRoot)) {
    return;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(baseRoot);
  } catch {
    return;
  }

  for (const entry of entries) {
    const editorPath = process.platform === "darwin"
      ? path.join(baseRoot, entry, "Unity.app")
      : process.platform === "win32"
        ? path.join(baseRoot, entry, "Editor", "Unity.exe")
        : path.join(baseRoot, entry, "Editor", "Unity");

    addInstall(candidates, seen, {
      version: inferVersionFromPath(editorPath),
      path: editorPath,
      source,
      exists: existsSync(editorPath),
    });
  }
}

function loadHubEditorMetadata(candidates: UnityInstall[], seen: Set<string>): void {
  const file = findHubFile("editors-v2.json");
  if (!file || !existsSync(file)) {
    return;
  }

  type HubEditor = {
    version?: string;
    location?: string[];
  };
  type HubPayload = {
    data?: HubEditor[];
  };

  try {
    const payload = JSON.parse(readFileSync(file, "utf-8")) as HubPayload;
    for (const item of payload.data ?? []) {
      for (const location of item.location ?? []) {
        addInstall(candidates, seen, {
          version: inferVersionFromPath(location, item.version ?? "unknown"),
          path: location,
          source: "Unity Hub metadata",
          exists: existsSync(location),
        });
      }
    }
  } catch {
    // Ignore malformed hub cache.
  }
}

function getUnityInstalls(): UnityInstall[] {
  const installs: UnityInstall[] = [];
  const seen = new Set<string>();

  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    scanInstallRoot(path.join(pf, "Unity", "Hub", "Editor"), installs, seen, "Hub-style path");
    scanInstallRoot(path.join(pf86, "Unity", "Hub", "Editor"), installs, seen, "Hub-style path");
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: path.join(pf, "Unity", "Editor", "Unity.exe"),
      source: "Legacy Unity path",
      exists: existsSync(path.join(pf, "Unity", "Editor", "Unity.exe")),
    });
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: path.join(pf86, "Unity", "Editor", "Unity.exe"),
      source: "Legacy Unity path",
      exists: existsSync(path.join(pf86, "Unity", "Editor", "Unity.exe")),
    });
  } else if (process.platform === "darwin") {
    scanInstallRoot("/Applications/Unity/Hub/Editor", installs, seen, "Hub-style path");
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: "/Applications/Unity/Unity.app",
      source: "Legacy Unity path",
      exists: existsSync("/Applications/Unity/Unity.app"),
    });
  } else {
    const home = process.env.HOME ?? "";
    scanInstallRoot(path.join(home, ".local", "share", "unity3d", "Hub", "Editor"), installs, seen, "Hub-style path");
    scanInstallRoot("/opt/Unity/Hub/Editor", installs, seen, "System");
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: "/opt/Unity/Editor/Unity",
      source: "Legacy Unity path",
      exists: existsSync("/opt/Unity/Editor/Unity"),
    });
  }

  loadHubEditorMetadata(installs, seen);

  return installs.sort((a, b) => {
    if (a.exists !== b.exists) {
      return a.exists ? -1 : 1;
    }
    return a.version.localeCompare(b.version, undefined, { numeric: true });
  });
}

function run(cmd: string, args: string[], cwd: string): string {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: 2000 });
  if (p.status === 0) {
    return (p.stdout ?? "").trim();
  }
  return "";
}

function runWithResult(cmd: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: 2000 });
  return {
    status: p.status,
    stdout: (p.stdout ?? "").trim(),
    stderr: (p.stderr ?? "").trim(),
  };
}

function emptyVcsStatus(kind = "None", branchOrStream = "", state = "not detected"): VcsStatus {
  return {
    kind,
    branchOrStream,
    state,
    localChangesCount: 0,
    incomingCount: 0,
    outgoingCount: 0,
    conflictCount: 0,
    infoMessage: "",
  };
}

function isGitRepo(projectPath: string): boolean {
  if (existsSync(path.join(projectPath, ".git"))) {
    return true;
  }
  return run("git", ["rev-parse", "--is-inside-work-tree"], projectPath) === "true";
}

function gitStatus(projectPath: string): VcsStatus {
  const statusResult = runWithResult("git", ["status", "--porcelain=v1", "--branch"], projectPath);
  if (statusResult.status !== 0) {
    const err = statusResult.stderr.toLowerCase();
    const blocked = err.includes("dubious ownership");
    return {
      kind: "Git",
      branchOrStream: blocked ? "safe.directory required" : "unavailable",
      state: blocked ? "unsafe ownership" : "error",
      localChangesCount: 0,
      incomingCount: 0,
      outgoingCount: 0,
      conflictCount: 0,
      infoMessage: blocked
        ? `Git blocked by safe.directory. Run: git config --global --add safe.directory ${projectPath.replace(/\\/g, "/")}`
        : statusResult.stderr || "Git status unavailable",
    };
  }

  const statusWithBranch = statusResult.stdout;
  const statusLines = statusWithBranch.split(/\r?\n/).filter((line) => line.trim().length > 0 && !line.startsWith("##"));
  const localChangesCount = statusLines.length;
  const conflictCount = statusLines.reduce((acc, line) => {
    const xy = line.slice(0, 2);
    const conflicted = xy.includes("U") || xy === "AA" || xy === "DD";
    return acc + (conflicted ? 1 : 0);
  }, 0);

  let incomingCount = 0;
  let outgoingCount = 0;
  const aheadBehind = run("git", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], projectPath);
  if (aheadBehind) {
    const parts = aheadBehind.split(/\s+/).map((value) => Number.parseInt(value, 10));
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      incomingCount = parts[0];
      outgoingCount = parts[1];
    }
  }

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectPath) || "unknown";
  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";
  return {
    kind: "Git",
    branchOrStream: branch,
    state,
    localChangesCount,
    incomingCount,
    outgoingCount,
    conflictCount,
    infoMessage: "",
  };
}

function isPerforce(projectPath: string): boolean {
  const out = run("p4", ["-d", projectPath, "info"], projectPath);
  return out.length > 0;
}

function perforceStatus(projectPath: string): VcsStatus {
  const streamLine = run("p4", ["-d", projectPath, "client", "-o"], projectPath)
    .split(/\r?\n/)
    .find((line) => line.startsWith("Stream:"));
  const opened = run("p4", ["-d", projectPath, "opened"], projectPath);
  const localChangesCount = opened
    ? opened.split(/\r?\n/).filter((line) => line.trim().length > 0).length
    : 0;

  const syncPreview = run("p4", ["-d", projectPath, "sync", "-n"], projectPath);
  const incomingCount = syncPreview && !syncPreview.toLowerCase().includes("up-to-date")
    ? syncPreview.split(/\r?\n/).filter((line) => line.trim().length > 0).length
    : 0;

  const resolvePreview = run("p4", ["-d", projectPath, "resolve", "-n"], projectPath);
  const conflictCount = resolvePreview
    ? resolvePreview.split(/\r?\n/).filter((line) => line.trim().length > 0).length
    : 0;
  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";

  return {
    kind: "Perforce",
    branchOrStream: streamLine ? streamLine.replace("Stream:", "").trim() : "workspace",
    state,
    localChangesCount,
    incomingCount,
    outgoingCount: 0,
    conflictCount,
    infoMessage: "",
  };
}

function isSvnRepo(projectPath: string): boolean {
  if (existsSync(path.join(projectPath, ".svn"))) {
    return true;
  }
  return run("svn", ["info"], projectPath).length > 0;
}

function svnStatus(projectPath: string): VcsStatus {
  const url = run("svn", ["info", "--show-item", "url"], projectPath);
  const localStatus = run("svn", ["status"], projectPath);
  const localLines = localStatus
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const localChangesCount = localLines.length;
  const conflictCount = localLines.filter((line) => line.startsWith("C")).length;

  const remoteStatus = run("svn", ["status", "-u"], projectPath);
  const incomingCount = remoteStatus
    .split(/\r?\n/)
    .filter((line) => line.length > 8 && line[8] === "*")
    .length;

  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";
  return {
    kind: "SVN",
    branchOrStream: url || "working copy",
    state,
    localChangesCount,
    incomingCount,
    outgoingCount: 0,
    conflictCount,
    infoMessage: "",
  };
}

function plasticWorkspaceKind(projectPath: string): "Plastic" | "Unity Version Control" {
  if (existsSync(path.join(projectPath, ".unityvcs"))) {
    return "Unity Version Control";
  }
  return "Plastic";
}

function isPlasticRepo(projectPath: string): boolean {
  if (existsSync(path.join(projectPath, ".plastic")) || existsSync(path.join(projectPath, ".unityvcs"))) {
    return true;
  }
  if (!commandExists("cm")) {
    return false;
  }
  return run("cm", ["status", "--noheaders"], projectPath).length > 0;
}

function plasticStatus(projectPath: string): VcsStatus {
  const kind = plasticWorkspaceKind(projectPath);
  const statusOutput = run("cm", ["status", "--noheaders"], projectPath);
  const statusLines = statusOutput
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const localChangesCount = statusLines.length;

  const conflictOutput = run("cm", ["resolve", "--pending"], projectPath);
  const conflictCount = conflictOutput
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.toLowerCase().includes("no pending"))
    .length;

  // Lightweight incoming preview; fallback to 0 if unavailable.
  const incomingOutput = run("cm", ["incoming", "--format={changesetid}"], projectPath);
  const incomingCount = incomingOutput
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;

  const branch =
    run("cm", ["status", "--header"], projectPath)
      .split(/\r?\n/)
      .find((line) => /branch|selector|workspace/i.test(line))
      ?.trim() ?? "workspace";
  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";
  return {
    kind,
    branchOrStream: branch,
    state,
    localChangesCount,
    incomingCount,
    outgoingCount: 0,
    conflictCount,
    infoMessage: "",
  };
}

function getVcsStatus(projectPath: string): VcsStatus {
  if (!existsSync(projectPath)) {
    return emptyVcsStatus("None", "", "missing path");
  }
  if (isGitRepo(projectPath)) {
    return gitStatus(projectPath);
  }
  if (isPerforce(projectPath)) {
    return perforceStatus(projectPath);
  }
  if (isSvnRepo(projectPath)) {
    return svnStatus(projectPath);
  }
  if (isPlasticRepo(projectPath)) {
    return plasticStatus(projectPath);
  }
  return emptyVcsStatus("None", "", "not detected");
}

function projectIsOpen(projectPath: string): boolean {
  return existsSync(path.join(projectPath, "Temp", "UnityLockfile"));
}

type FocusResult = {
  ok: boolean;
  reason?: string;
};

function commandExists(cmd: string): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const p = spawnSync(checker, [cmd], { encoding: "utf-8", timeout: 2000 });
  return p.status === 0;
}

function projectTitleCandidates(project: ProjectEntry): string[] {
  const basename = path.basename(project.path);
  return [project.nickname, project.name, basename]
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

function focusUnityWindowWindows(project: ProjectEntry): FocusResult {
  const candidates = projectTitleCandidates(project);
  if (candidates.length === 0) {
    return { ok: false, reason: "no project title candidates" };
  }

  const escaped = candidates.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$targets = @(${escaped})
$script:matched = $false

[Win32]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $titleBuilder = New-Object System.Text.StringBuilder 512
  [void][Win32]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
  $title = $titleBuilder.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }

  $windowPid = 0
  [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  if ($windowPid -le 0) { return $true }

  try {
    $proc = [System.Diagnostics.Process]::GetProcessById([int]$windowPid)
  } catch {
    return $true
  }

  if ($proc.ProcessName -ne 'Unity') { return $true }

  foreach ($target in $targets) {
    if ($title -like ('*' + $target + '*')) {
      [void][Win32]::ShowWindow($hWnd, 9)
      [void][Win32]::SetForegroundWindow($hWnd)
      $script:matched = $true
      return $false
    }
  }

  return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:matched) { exit 0 } else { exit 1 }
`;
  const p = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf-8", timeout: 3000 });
  return p.status === 0
    ? { ok: true }
    : { ok: false, reason: "no matching Unity window title found" };
}

function focusUnityWindowMac(project: ProjectEntry): FocusResult {
  if (!commandExists("osascript")) {
    return { ok: false, reason: "missing dependency: osascript" };
  }

  const candidates = projectTitleCandidates(project);
  if (candidates.length === 0) {
    return { ok: false, reason: "no project title candidates" };
  }

  const escaped = candidates.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(", ");
  const script = `
set targets to {${escaped}}
tell application "System Events"
  if not (exists process "Unity") then return "missing"
  tell process "Unity"
    set frontmost to true
    repeat with w in windows
      set windowName to (name of w) as text
      repeat with t in targets
        if windowName contains t then
          try
            perform action "AXRaise" of w
          end try
          set frontmost to true
          return "ok"
        end if
      end repeat
    end repeat
  end tell
end tell
return "nomatch"
`;
  const p = spawnSync("osascript", ["-e", script], { encoding: "utf-8", timeout: 4000 });
  const out = (p.stdout ?? "").trim().toLowerCase();
  if (p.status === 0 && out.includes("ok")) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "focus failed on macOS. Ensure Accessibility permission is granted to the app/terminal in System Settings > Privacy & Security > Accessibility.",
  };
}

function focusUnityWindowLinux(project: ProjectEntry): FocusResult {
  const candidates = projectTitleCandidates(project);
  if (candidates.length === 0) {
    return { ok: false, reason: "no project title candidates" };
  }

  const hasWmctrl = commandExists("wmctrl");
  const hasXdotool = commandExists("xdotool");
  if (!hasWmctrl && !hasXdotool) {
    return {
      ok: false,
      reason: "missing dependency: install wmctrl or xdotool (Ubuntu/Debian: sudo apt install wmctrl xdotool, Fedora: sudo dnf install wmctrl xdotool, Arch: sudo pacman -S wmctrl xdotool).",
    };
  }

  if (hasWmctrl) {
    const list = run("wmctrl", ["-l"], project.path);
    const lines = list.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const id = line.split(/\s+/)[0];
      const lower = line.toLowerCase();
      if (!lower.includes("unity")) {
        continue;
      }
      if (!candidates.some((target) => lower.includes(target.toLowerCase()))) {
        continue;
      }
      const activate = spawnSync("wmctrl", ["-ia", id], { encoding: "utf-8", timeout: 3000 });
      if (activate.status === 0) {
        return { ok: true };
      }
    }
  }

  if (hasXdotool) {
    for (const target of candidates) {
      const activate = spawnSync("xdotool", ["search", "--name", target, "windowactivate"], {
        encoding: "utf-8",
        timeout: 3000,
      });
      if (activate.status === 0) {
        return { ok: true };
      }
    }
  }

  return { ok: false, reason: "no matching Unity window title found" };
}

function focusUnityWindow(project: ProjectEntry): FocusResult {
  if (process.platform === "win32") {
    return focusUnityWindowWindows(project);
  }
  if (process.platform === "darwin") {
    return focusUnityWindowMac(project);
  }
  if (process.platform === "linux") {
    return focusUnityWindowLinux(project);
  }
  return { ok: false, reason: "platform not supported for window focusing" };
}

function launchProject(project: ProjectEntry): {
  ok: boolean;
  message: string;
  focused?: boolean;
  resolvedUnityExe?: string;
} {
  if (!existsSync(project.path)) {
    return { ok: false, message: "Project path does not exist." };
  }

  const projectVersion = project.unityVersion.trim().toLowerCase();
  const existingExe = project.unityExe.trim();
  let resolvedExe = existingExe;
  if (!resolvedExe || !existsSync(resolvedExe)) {
    const installs = getUnityInstalls().filter((install) => install.exists);
    const exact = installs.find((install) => install.version.trim().toLowerCase() === projectVersion);
    const compatible = installs.find((install) => {
      const v = install.version.trim().toLowerCase();
      return v.startsWith(projectVersion) || projectVersion.startsWith(v);
    });
    resolvedExe = exact?.path ?? compatible?.path ?? installs[0]?.path ?? "";
  }

  if (projectIsOpen(project.path)) {
    const focus = focusUnityWindow(project);
    if (focus.ok) {
      return {
        ok: true,
        message: "Project already open. Focused existing Unity window.",
        focused: true,
        resolvedUnityExe: resolvedExe,
      };
    }
    // Lockfile can be stale; proceed with launch if focus fails.
    const reason = focus.reason ? ` ${focus.reason}` : "";
    try {
      if (!resolvedExe || !existsSync(resolvedExe)) {
        return {
          ok: false,
          message: `Project appears open, but focus failed.${reason} Unity executable is not set or does not exist.`.trim(),
          focused: false,
          resolvedUnityExe: resolvedExe,
        };
      }
      spawn(resolvedExe, ["-projectPath", project.path], { detached: true, stdio: "ignore" }).unref();
      return {
        ok: true,
        message: `Project appears open, but focus failed.${reason} Attempting launch.`.trim(),
        focused: false,
        resolvedUnityExe: resolvedExe,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Project appears open, but focus failed.${reason} Failed to launch: ${String(error)}`.trim(),
        focused: false,
        resolvedUnityExe: resolvedExe,
      };
    }
  }

  if (!resolvedExe || !existsSync(resolvedExe)) {
    return { ok: false, message: "Unity executable is not set or does not exist." };
  }

  try {
    spawn(resolvedExe, ["-projectPath", project.path], { detached: true, stdio: "ignore" }).unref();
    return {
      ok: true,
      message: "Launched Unity project.",
      resolvedUnityExe: resolvedExe,
    };
  } catch (error) {
    return { ok: false, message: `Failed to launch: ${String(error)}` };
  }
}

function launchUnityEditor(editorPath: string): { ok: boolean; message: string } {
  if (!existsSync(editorPath)) {
    return { ok: false, message: "Unity editor path does not exist." };
  }
  try {
    spawn(editorPath, [], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, message: "Launched Unity editor." };
  } catch (error) {
    return { ok: false, message: `Failed to launch editor: ${String(error)}` };
  }
}

function browseToPath(targetPath: string): { ok: boolean; message: string } {
  const value = targetPath.trim();
  if (!value) {
    return { ok: false, message: "Path is required." };
  }
  if (!existsSync(value)) {
    return { ok: false, message: "Path does not exist." };
  }

  try {
    const info = statSync(value);
    if (info.isDirectory()) {
      void shell.openPath(value);
      return { ok: true, message: "Opened folder in file explorer." };
    }
    shell.showItemInFolder(value);
    return { ok: true, message: "Revealed item in file explorer." };
  } catch (error) {
    return { ok: false, message: `Failed to browse path: ${String(error)}` };
  }
}

function cloneRepository(repoUrl: string, targetDir: string, branch: string): { ok: boolean; message: string } {
  if (!repoUrl.trim()) {
    return { ok: false, message: "Repository URL is required." };
  }
  if (!targetDir.trim()) {
    return { ok: false, message: "Target directory is required." };
  }

  const args = ["clone"];
  if (branch.trim()) {
    args.push("--branch", branch.trim());
  }
  args.push(repoUrl.trim(), targetDir.trim());

  const p = spawnSync("git", args, { encoding: "utf-8", timeout: 120000 });
  if (p.status === 0) {
    return { ok: true, message: "Repository cloned." };
  }
  const stderr = (p.stderr ?? "").trim();
  return { ok: false, message: stderr || "Failed to clone repository." };
}

function upsertProject(incoming: ProjectEntry): ProjectEntry[] {
  const store = loadStore();
  const project = { ...incoming };
  if (!project.id) {
    project.id = randomUUID();
  }
  if (!project.name.trim()) {
    project.name = path.basename(project.path);
  }
  if (!project.nickname.trim()) {
    project.nickname = project.name;
  }
  if (!project.unityVersion.trim()) {
    project.unityVersion = detectUnityVersion(project.path);
  }

  const idx = store.projects.findIndex((x) => x.id === project.id);
  if (idx >= 0) {
    store.projects[idx] = project;
  } else {
    store.projects.push(project);
  }
  saveStore(store);
  return store.projects;
}

function deleteProject(id: string): ProjectEntry[] {
  const store = loadStore();
  store.projects = store.projects.filter((x) => x.id !== id);
  saveStore(store);
  return store.projects;
}

function removeMissingProjects(): { removed: number; remaining: number } {
  const store = loadStore();
  const before = store.projects.length;
  store.projects = store.projects.filter((p) => existsSync(p.path));
  const removed = before - store.projects.length;
  saveStore(store);
  return { removed, remaining: store.projects.length };
}

function createWindow(): void {
  const store = loadStore();
  const disableRenderThrottling = store.meta.disableRenderThrottling ?? true;
  const bgColor = nativeTheme.shouldUseDarkColors ? "#121212" : "#f4f4f4";
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 760,
    minWidth: 800,
    minHeight: 400,
    show: false,
    backgroundColor: bgColor,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !disableRenderThrottling,
    },
  };

  if (process.platform === "win32" || process.platform === "darwin") {
    windowOptions.titleBarStyle = "hidden";
    if (process.platform === "win32") {
      windowOptions.titleBarOverlay = {
        color: bgColor,
        symbolColor: nativeTheme.shouldUseDarkColors ? "#e8e8e8" : "#1b1b1b",
        height: 30,
      };
    }
  }

  const win = new BrowserWindow(windowOptions);
  win.setMenuBarVisibility(false);

  const htmlPath = path.join(__dirname, "renderer", "index.html");
  win.loadFile(htmlPath);
  win.once("ready-to-show", () => {
    win.show();
  });
}

app.whenReady().then(() => {
  const dataFile = getDataFile();
  const dir = path.dirname(dataFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const store = loadStore();
  const bootstrapped = bootstrapFromHubOnFirstRun(store);
  saveStore(bootstrapped);

  ipcMain.handle("projects:get", () => loadStore().projects);
  ipcMain.handle("projects:save", (_event, project: ProjectEntry) => upsertProject(project));
  ipcMain.handle("projects:delete", (_event, id: string) => deleteProject(id));
  ipcMain.handle("projects:removeMissing", () => removeMissingProjects());
  ipcMain.handle("settings:get", () => {
    const store = loadStore();
    return {
      disableRenderThrottling: store.meta.disableRenderThrottling ?? true,
    };
  });
  ipcMain.handle("settings:setDisableRenderThrottling", (_event, value: boolean) => {
    const store = loadStore();
    store.meta.disableRenderThrottling = value;
    saveStore(store);
    return { ok: true };
  });
  ipcMain.handle("unity:detectVersion", (_event, projectPath: string) => detectUnityVersion(projectPath));
  ipcMain.handle("unity:projectIcon", (_event, projectPath: string) => detectProjectIconDataUrl(projectPath));
  ipcMain.handle("vcs:status", (_event, projectPath: string) => getVcsStatus(projectPath));
  ipcMain.handle("project:isOpen", (_event, projectPath: string) => projectIsOpen(projectPath));
  ipcMain.handle("unity:installs", () => getUnityInstalls());
  ipcMain.handle("unity:launchOrFocus", (_event, project: ProjectEntry) => {
    const result = launchProject(project);
    if (result.ok && !result.focused) {
      const updated = {
        ...project,
        unityExe: result.resolvedUnityExe || project.unityExe,
        lastOpenedIso: new Date().toISOString(),
      };
      upsertProject(updated);
    }
    return result;
  });
  ipcMain.handle("unity:launchEditor", (_event, editorPath: string) => launchUnityEditor(editorPath));
  ipcMain.handle("path:browseTo", (_event, targetPath: string) => browseToPath(targetPath));
  ipcMain.handle("dialog:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }
    return result.filePaths[0];
  });
  ipcMain.handle("dialog:pickFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Executables", extensions: ["exe", "app"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }
    return result.filePaths[0];
  });
  ipcMain.handle("repo:clone", (_event, repoUrl: string, targetDir: string, branch: string) =>
    cloneRepository(repoUrl, targetDir, branch),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

